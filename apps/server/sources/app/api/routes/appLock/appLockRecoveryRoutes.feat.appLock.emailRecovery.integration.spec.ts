import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { appLockRecoveryRoutes } from "./appLockRecoveryRoutes";

// SMTP is an external system boundary: capture outgoing mail instead of connecting to a server.
const sentMail = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string }>);
const mailFailure = vi.hoisted(() => ({ fail: false }));
vi.mock("@/modules/mail/sendMail", () => ({
    sendMail: async (message: { to: string; subject: string; text: string }) => {
        if (mailFailure.fail) throw new Error("smtp down");
        sentMail.push(message);
    },
}));

const SMTP_ENV = { HAPPIER_SMTP_URL: "smtp://mail.invalid:2525", HAPPIER_SMTP_FROM: "Happier <noreply@example.com>" };
const LOCK_ID = "lock_0123456789abcdefghijkl";
const RECOVERY_KEY = `${"A".repeat(43)}=`;

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
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-app-lock-recovery-" });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    afterEach(async () => {
        sentMail.length = 0;
        mailFailure.fail = false;
        harness.resetEnv(SMTP_ENV);
        await harness.resetDbTables([
            () => db.appLockRecovery.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    async function createAccount(publicKey: string): Promise<string> {
        const account = await db.account.create({ data: { publicKey }, select: { id: true } });
        return account.id;
    }

    async function register(app: any, userId: string, email = "owner@example.com") {
        return await app.inject({
            method: "POST",
            url: "/v1/app-lock/recovery",
            headers: { "x-test-user-id": userId },
            payload: { lockId: LOCK_ID, email, recoveryKey: RECOVERY_KEY },
        });
    }

    async function verifyAndClearCooldown(app: any, userId: string) {
        await register(app, userId);
        const verify = await app.inject({
            method: "POST",
            url: "/v1/app-lock/recovery/verify",
            headers: { "x-test-user-id": userId },
            payload: { lockId: LOCK_ID, code: lastCode() },
        });
        expect(verify.statusCode).toBe(200);
        await db.appLockRecovery.update({ where: { id: LOCK_ID }, data: { codeSentAt: null } });
    }

    it("releases the recovery key only to a reset code sent to a verified email, once", async () => {
        harness.resetEnv(SMTP_ENV);
        const userId = await createAccount("pk-app-lock-flow");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            expect((await register(app, userId)).statusCode).toBe(200);
            expect(sentMail.at(-1)?.to).toBe("owner@example.com");

            // Unverified escrow cannot be used for a reset.
            const early = await app.inject({ method: "POST", url: "/v1/app-lock/recovery/reset-code", payload: { lockId: LOCK_ID } });
            expect(early.statusCode).toBe(404);
            expect(early.json()).toEqual({ error: "not_found" });

            const verify = await app.inject({
                method: "POST",
                url: "/v1/app-lock/recovery/verify",
                headers: { "x-test-user-id": userId },
                payload: { lockId: LOCK_ID, code: lastCode() },
            });
            expect(verify.statusCode).toBe(200);
            await db.appLockRecovery.update({ where: { id: LOCK_ID }, data: { codeSentAt: null } });

            const resetCode = await app.inject({ method: "POST", url: "/v1/app-lock/recovery/reset-code", payload: { lockId: LOCK_ID } });
            expect(resetCode.statusCode).toBe(200);
            const code = lastCode();

            const wrong = await app.inject({ method: "POST", url: "/v1/app-lock/recovery/redeem", payload: { lockId: LOCK_ID, code: otherCode(code) } });
            expect(wrong.statusCode).toBe(400);
            expect(wrong.json()).toEqual({ error: "invalid_code" });

            const redeem = await app.inject({ method: "POST", url: "/v1/app-lock/recovery/redeem", payload: { lockId: LOCK_ID, code } });
            expect(redeem.statusCode).toBe(200);
            expect(redeem.json()).toEqual({ recoveryKey: RECOVERY_KEY });

            const reuse = await app.inject({ method: "POST", url: "/v1/app-lock/recovery/redeem", payload: { lockId: LOCK_ID, code } });
            expect(reuse.statusCode).toBe(400);
        });
    });

    it("stops accepting a code after five wrong attempts and rate limits new codes", async () => {
        const userId = await createAccount("pk-app-lock-attempts");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            await verifyAndClearCooldown(app, userId);
            await app.inject({ method: "POST", url: "/v1/app-lock/recovery/reset-code", payload: { lockId: LOCK_ID } });
            const code = lastCode();

            const again = await app.inject({ method: "POST", url: "/v1/app-lock/recovery/reset-code", payload: { lockId: LOCK_ID } });
            expect(again.statusCode).toBe(429);
            expect(again.json().error).toBe("cooldown");
            expect(again.json().retryAfterSeconds).toBeGreaterThan(0);

            const guesses = await Promise.all(Array.from({ length: 5 }, () => app.inject({
                method: "POST",
                url: "/v1/app-lock/recovery/redeem",
                payload: { lockId: LOCK_ID, code: otherCode(code) },
            })));
            expect(guesses.every((response: any) => response.statusCode === 400)).toBe(true);

            const correct = await app.inject({ method: "POST", url: "/v1/app-lock/recovery/redeem", payload: { lockId: LOCK_ID, code } });
            expect(correct.statusCode).toBe(400);
            expect(correct.json()).toEqual({ error: "too_many_attempts" });
        });
    });

    it("keeps lock ids private to their account and reports mail failures", async () => {
        const ownerId = await createAccount("pk-app-lock-owner");
        const otherId = await createAccount("pk-app-lock-other");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            expect((await register(app, ownerId)).statusCode).toBe(200);
            const hijack = await register(app, otherId, "attacker@example.com");
            expect(hijack.statusCode).toBe(404);
            expect((await db.appLockRecovery.findUnique({ where: { id: LOCK_ID } }))?.email).toBe("owner@example.com");

            await db.appLockRecovery.deleteMany();
            mailFailure.fail = true;
            const failed = await register(app, ownerId);
            expect(failed.statusCode).toBe(502);
            expect(failed.json()).toEqual({ error: "email_failed" });
        });
    });

    it("is unavailable when the server has no SMTP settings", async () => {
        harness.resetEnv();
        const userId = await createAccount("pk-app-lock-disabled");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            expect((await register(app, userId)).statusCode).toBe(404);
            expect(sentMail).toHaveLength(0);
        });
    });
});
