import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/storage/db";
import { createLightSqliteHarness, type LightSqliteHarness } from "@/testkit/lightSqliteHarness";
import { withAuthenticatedTestApp } from "../../testkit/sqliteFastify";
import { appLockRecoveryRoutes } from "./appLockRecoveryRoutes";

const KDF = { alg: "scrypt", N: 1024, r: 8, p: 1, salt: "c2FsdHNhbHRzYWx0" } as const;
const WRAPPED = "d3JhcHBlZC1rZXktb25l";
const DEVICE_WRAPPED = "ZGV2aWNlLXdyYXBwZWQ";

describe("app lock account lock routes (integration)", () => {
    let harness: LightSqliteHarness;

    beforeAll(async () => {
        harness = await createLightSqliteHarness({ tempDirPrefix: "happier-app-lock-account-" });
    }, 120_000);

    afterAll(async () => {
        await harness.close();
    });

    beforeEach(() => {
        harness.resetEnv({ HAPPIER_FEATURE_APP_LOCK__EMAIL_RECOVERY__ENABLED: "1" });
    });

    afterEach(async () => {
        harness.resetEnv();
        await harness.resetDbTables([
            () => db.appLockAccountLock.deleteMany(),
            () => db.account.deleteMany(),
        ]);
    });

    async function createAccount(publicKey: string): Promise<string> {
        return (await db.account.create({ data: { publicKey }, select: { id: true } })).id;
    }

    function get(app: any, userId: string) {
        return app.inject({ method: "GET", url: "/v1/app-lock/account-lock", headers: { "x-test-user-id": userId } });
    }

    function put(app: any, userId: string, expectedVersion: number | null, passwordWrappedKey = WRAPPED) {
        return app.inject({
            method: "PUT",
            url: "/v1/app-lock/account-lock",
            headers: { "x-test-user-id": userId },
            payload: { kdf: KDF, passwordWrappedKey, deviceWrappedKey: DEVICE_WRAPPED, expectedVersion },
        });
    }

    it("creates the account lock once, then re-wraps it only from the current version", async () => {
        const userId = await createAccount("pk-account-lock-versions");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            expect((await get(app, userId)).json()).toEqual({ lock: null });

            const created = await put(app, userId, null);
            expect(created.statusCode).toBe(200);
            expect(created.json()).toEqual({ version: 1 });
            expect((await get(app, userId)).json()).toEqual({
                lock: { version: 1, kdf: KDF, passwordWrappedKey: WRAPPED, deviceWrappedKey: DEVICE_WRAPPED },
            });

            // A second device that also thinks it is first must not overwrite the existing lock.
            const duplicate = await put(app, userId, null, "b3RoZXI");
            expect(duplicate.statusCode).toBe(409);
            expect(duplicate.json()).toEqual({ error: "version_conflict" });

            const rewrapped = await put(app, userId, 1, "bmV3LXdyYXA");
            expect(rewrapped.json()).toEqual({ version: 2 });

            // A device still based on version 1 (password changed elsewhere) is refused.
            const stale = await put(app, userId, 1, "c3RhbGU");
            expect(stale.statusCode).toBe(409);
            expect(stale.json()).toEqual({ error: "version_conflict" });
            expect((await get(app, userId)).json().lock.passwordWrappedKey).toBe("bmV3LXdyYXA");
        });
    });

    it("applies concurrent re-wraps from the same version exactly once", async () => {
        const userId = await createAccount("pk-account-lock-race");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            await put(app, userId, null);
            const results = await Promise.all([put(app, userId, 1, "YQ"), put(app, userId, 1, "Yg"), put(app, userId, 1, "Yw")]);
            expect(results.filter((response: any) => response.statusCode === 200)).toHaveLength(1);
            expect((await get(app, userId)).json().lock.version).toBe(2);
        });
    });

    it("keeps each account's lock separate", async () => {
        const userId = await createAccount("pk-account-lock-mine");
        const otherId = await createAccount("pk-account-lock-other");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            await put(app, userId, null);
            expect((await get(app, otherId)).json()).toEqual({ lock: null });
            // The other account has no lock to re-wrap, so version 1 does not exist for it.
            expect((await put(app, otherId, 1)).statusCode).toBe(409);
            expect((await get(app, userId)).json().lock.version).toBe(1);
        });
    });

    it("is unavailable when the operator turns the feature off", async () => {
        harness.resetEnv({ HAPPIER_FEATURE_APP_LOCK__EMAIL_RECOVERY__ENABLED: "0" });
        const userId = await createAccount("pk-account-lock-disabled");
        await withAuthenticatedTestApp(appLockRecoveryRoutes, async (app) => {
            expect((await get(app, userId)).statusCode).toBe(404);
            expect((await put(app, userId, null)).statusCode).toBe(404);
        });
    });
});
