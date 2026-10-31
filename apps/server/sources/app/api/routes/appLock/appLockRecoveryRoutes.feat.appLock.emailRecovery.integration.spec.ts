import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { appLockRecoveryRoutes } from "./appLockRecoveryRoutes";

// SMTP is an external system boundary: capture outgoing mail instead of connecting to a server.
type SentMail = { settings: { host: string; port: number; security: string; username: string; password: string | null; fromAddress: string }; to: string; subject: string; text: string };
const sentMail = vi.hoisted(() => [] as SentMail[]);
const mailFailure = vi.hoisted(() => ({ fail: false }));
vi.mock("@/modules/mail/sendMail", () => ({
    sendMail: async (settings: SentMail["settings"], message: { to: string; subject: string; text: string }) => {
        if (mailFailure.fail) throw new Error("smtp down");
        sentMail.push({ settings, ...message });
    },
}));

const LOCK_ID = "lock_0123456789abcdefghijkl";
const RECOVERY_KEY = `${"A".repeat(43)}=`;
const MAIL_SETTINGS = {
    host: "smtp.example.com",
    port: 587,
    security: "starttls",
    username: "owner@example.com",
    password: "smtp-secret-password",
    fromAddress: "Happier <owner@example.com>",
};

function lastCode(): string {
    const text = sentMail.at(-1)?.text ?? "";
    const match = /\b(\d{6})\b/.exec(text);
    if (!match) throw new Error(`no code in mail: ${text}`);
    return match[1]!;
}

function otherCode(code: string): string {
    return code === "000000" ? "111111" : "000000";
}

describe("app lock recovery routes (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-app-lock-recovery-", initEncrypt: true });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    afterEach(async () => {
        sentMail.length = 0;
        mailFailure.fail = false;
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.appLockRecovery.deleteMany(),
            () => db.appLockMailSettings.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    async function createAccount(publicKey: string): Promise<string> {
        const account = await db.account.create({ data: { publicKey }, select: { id: true } });
        return account.id;
    }

    async function saveMailSettings(app: any, userId: string, body: Record<string, unknown> = MAIL_SETTINGS) {
        return await app.inject({ method: "PUT", url: "/v1/app-lock/mail-settings", headers: { "x-test-user-id": userId }, payload: body });
    }

    async function register(app: any, userId: string, email = "owner@example.com") {
        return await app.inject({
            method: "POST",
            url: "/v1/app-lock/recovery",
            headers: { "x-test-user-id": userId },
            payload: { lockId: LOCK_ID, email, recoveryKey: RECOVERY_KEY },
        });
    }

    async function requestResetCode(app: any) {
        return await app.inject({ method: "POST", url: "/v1/app-lock/recovery/reset-code", payload: { lockId: LOCK_ID } });
    }

    async function redeem(app: any, code: string) {
        return await app.inject({ method: "POST", url: "/v1/app-lock/recovery/redeem", payload: { lockId: LOCK_ID, code } });
    }

    it("needs the account's mail settings, keeps the SMTP password private, and sends through them", async () => {
        const userId = await createAccount("pk-app-lock-mail");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            const early = await register(app, userId);
            expect(early.statusCode).toBe(409);
            expect(early.json()).toEqual({ error: "mail_not_configured" });

            expect((await saveMailSettings(app, userId)).statusCode).toBe(200);
            const read = await app.inject({ method: "GET", url: "/v1/app-lock/mail-settings", headers: { "x-test-user-id": userId } });
            expect(read.json()).toEqual({
                settings: {
                    host: "smtp.example.com",
                    port: 587,
                    security: "starttls",
                    username: "owner@example.com",
                    fromAddress: "Happier <owner@example.com>",
                    hasPassword: true,
                },
            });
            expect(read.body).not.toContain("smtp-secret-password");
            const stored = await db.appLockMailSettings.findUnique({ where: { accountId: userId } });
            expect(Buffer.from(stored!.passwordEncrypted!).toString("utf8")).not.toContain("smtp-secret-password");

            // Saving without a password keeps the saved one.
            const { password: _omit, ...withoutPassword } = MAIL_SETTINGS;
            expect((await saveMailSettings(app, userId, { ...withoutPassword, port: 465, security: "tls" })).statusCode).toBe(200);

            expect((await register(app, userId)).statusCode).toBe(200);
            expect((await requestResetCode(app)).statusCode).toBe(200);
            expect(sentMail.at(-1)).toMatchObject({
                to: "owner@example.com",
                settings: { host: "smtp.example.com", port: 465, security: "tls", password: "smtp-secret-password" },
            });

            const test = await app.inject({
                method: "POST",
                url: "/v1/app-lock/mail-settings/test",
                headers: { "x-test-user-id": userId },
                payload: { to: "someone@example.com" },
            });
            expect(test.statusCode).toBe(200);
            expect(sentMail.at(-1)?.to).toBe("someone@example.com");
        });
    });

    it("releases the recovery key only for the emailed reset code, once", async () => {
        const userId = await createAccount("pk-app-lock-flow");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            await saveMailSettings(app, userId);
            await register(app, userId);
            expect((await requestResetCode(app)).statusCode).toBe(200);
            const code = lastCode();

            const wrong = await redeem(app, otherCode(code));
            expect(wrong.statusCode).toBe(400);
            expect(wrong.json()).toEqual({ error: "invalid_code" });

            const ok = await redeem(app, code);
            expect(ok.statusCode).toBe(200);
            expect(ok.json()).toEqual({ recoveryKey: RECOVERY_KEY });

            expect((await redeem(app, code)).statusCode).toBe(400);
        });
    });

    it("stops accepting a code after five wrong attempts and rate limits new codes", async () => {
        const userId = await createAccount("pk-app-lock-attempts");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            await saveMailSettings(app, userId);
            await register(app, userId);
            await requestResetCode(app);
            const code = lastCode();

            const again = await requestResetCode(app);
            expect(again.statusCode).toBe(429);
            expect(again.json().error).toBe("cooldown");
            expect(again.json().retryAfterSeconds).toBeGreaterThan(0);

            const guesses = await Promise.all(Array.from({ length: 5 }, () => redeem(app, otherCode(code))));
            expect(guesses.every((response: any) => response.statusCode === 400)).toBe(true);

            const correct = await redeem(app, code);
            expect(correct.statusCode).toBe(400);
            expect(correct.json()).toEqual({ error: "too_many_attempts" });
        });
    });

    it("keeps lock ids private to their account and reports mail failures", async () => {
        const ownerId = await createAccount("pk-app-lock-owner");
        const otherId = await createAccount("pk-app-lock-other");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            await saveMailSettings(app, ownerId);
            await saveMailSettings(app, otherId);
            expect((await register(app, ownerId)).statusCode).toBe(200);
            const hijack = await register(app, otherId, "attacker@example.com");
            expect(hijack.statusCode).toBe(404);
            expect((await db.appLockRecovery.findUnique({ where: { id: LOCK_ID } }))?.email).toBe("owner@example.com");

            mailFailure.fail = true;
            const failed = await requestResetCode(app);
            expect(failed.statusCode).toBe(502);
            expect(failed.json()).toEqual({ error: "email_failed" });
        });
    });

    it("is unavailable when the operator turns the feature off", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_APP_LOCK__EMAIL_RECOVERY__ENABLED: "0" });
        const userId = await createAccount("pk-app-lock-disabled");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            expect((await saveMailSettings(app, userId)).statusCode).toBe(404);
            expect((await register(app, userId)).statusCode).toBe(404);
        });
    });
});
