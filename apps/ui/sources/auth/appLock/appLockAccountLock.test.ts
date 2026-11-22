import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock, type LocalStorageMockHandle } from '@/auth/storage/tokenStorage.web.testHelpers';

installTokenStorageWebPlatformMocks();

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 } as const;
const SERVER_URL = 'https://relay.example.test';

type FakeLock = { version: number; required: boolean; kdf: Record<string, unknown>; passwordWrappedKey: string };

// The relay is the network boundary: an in-memory stand-in that enforces the same version rule.
const relay = vi.hoisted(() => ({
    lock: null as FakeLock | null,
    offline: false,
    recoveryEmail: 'owner@example.com' as string | null,
    registered: [] as string[],
    removed: [] as string[],
    puts: [] as Array<{ expectedVersion: number | null }>,
}));

vi.mock('@/sync/api/appLock/apiAppLockRecovery', () => ({
    apiAppLockAccountLockGet: async () => (relay.offline ? { ok: false, error: 'network' } : { ok: true, lock: relay.lock }),
    apiAppLockAccountLockPut: async (request: { kdf: Record<string, unknown>; passwordWrappedKey: string; expectedVersion: number | null }) => {
        if (relay.offline) return { ok: false, error: 'network' };
        relay.puts.push({ expectedVersion: request.expectedVersion });
        if (request.expectedVersion === null ? relay.lock !== null : relay.lock?.version !== request.expectedVersion) {
            return { ok: false, error: 'version_conflict' };
        }
        const version = (relay.lock?.version ?? 0) + 1;
        relay.lock = { version, required: relay.lock?.required ?? true, kdf: request.kdf, passwordWrappedKey: request.passwordWrappedKey };
        return { ok: true, version };
    },
    apiAppLockAccountLockSetRequired: async (required: boolean) => {
        if (relay.offline) return { ok: false, error: 'network' };
        if (!relay.lock) return { ok: false, error: 'not_found' };
        relay.lock = { ...relay.lock, required };
        return { ok: true };
    },
    apiAppLockMailSettingsGet: async () => ({
        ok: true,
        settings: relay.recoveryEmail ? { recoveryEmail: relay.recoveryEmail, host: 'smtp.example.com' } : null,
    }),
    apiAppLockRecoveryRegister: async (request: { lockId: string }) => {
        relay.registered.push(request.lockId);
        return { ok: true };
    },
    apiAppLockRecoveryRemove: async (request: { lockId: string }) => {
        relay.removed.push(request.lockId);
        return { ok: true };
    },
    apiAppLockRecoveryRequestResetCode: async () => ({ ok: true }),
    apiAppLockRecoveryRedeem: async () => ({ ok: false, error: 'not_found' }),
}));

async function freshKeys(password: string) {
    const { createAppLockKeys } = await import('./appLockCrypto');
    const keys = await createAppLockKeys(password, FAST_KDF);
    const record = {
        v: 1 as const,
        lockId: 'lock_0123456789abcdefghijkl',
        email: 'owner@example.com',
        serverUrl: SERVER_URL,
        wrapped: keys.wrapped,
        autoLockMinutes: 5,
        biometric: false,
    };
    const lock = (version: number, required = true): FakeLock => ({
        version,
        required,
        kdf: keys.wrapped.kdf,
        passwordWrappedKey: keys.wrapped.passwordWrappedKey,
    });
    return { keys, record, lock };
}

describe('account-wide app lock', () => {
    let storage: LocalStorageMockHandle | null = null;

    beforeEach(() => {
        vi.resetModules();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        relay.lock = null;
        relay.offline = false;
        relay.recoveryEmail = 'owner@example.com';
        relay.registered.length = 0;
        relay.removed.length = 0;
        relay.puts.length = 0;
        storage = installLocalStorageMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        storage?.restore();
        storage = null;
    });

    async function loadModules() {
        const { setServerUrl } = await import('@/sync/domains/server/serverConfig');
        setServerUrl(SERVER_URL);
        const runtime = await import('./appLockRuntime');
        const account = await import('./appLockAccountState');
        const sync = await import('./appLockAccountSync');
        const setup = await import('./appLockSetup');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await runtime.loadAppLock();
        await account.loadAppLockAccountState();
        return { runtime, account, sync, setup, TokenStorage };
    }

    it('turns an existing device lock into the account lock when the account has none', async () => {
        const { runtime, account, sync } = await loadModules();
        const { record, keys } = await freshKeys('pw-legacy');
        await runtime.activateAppLock(record, keys.dataKey);

        await sync.syncAppLockAccountLock();

        expect(relay.lock).toMatchObject({ version: 1, required: true, passwordWrappedKey: record.wrapped.passwordWrappedKey });
        expect(runtime.getAppLockSnapshot().record?.accountKeyVersion).toBe(1);
        expect(account.getAppLockAccountState().required).toBe(true);
    });

    it('adopts a password changed on another device, and the old password stops working', async () => {
        const { runtime, sync } = await loadModules();
        const { record, keys } = await freshKeys('old-password');
        await runtime.activateAppLock({ ...record, accountKeyVersion: 1 }, keys.dataKey);

        // Another device re-wrapped the same data key under a new password (version 2).
        const { rewrapAppLockPassword } = await import('./appLockCrypto');
        const rewrapped = await rewrapAppLockPassword(record.wrapped, keys.dataKey, 'new-password', FAST_KDF);
        relay.lock = { version: 2, required: true, kdf: rewrapped.kdf, passwordWrappedKey: rewrapped.passwordWrappedKey };

        await sync.syncAppLockAccountLock();

        expect(runtime.getAppLockSnapshot().record?.accountKeyVersion).toBe(2);
        await expect(runtime.verifyAppLockPassword('old-password')).resolves.toBe(false);
        await expect(runtime.verifyAppLockPassword('new-password')).resolves.toBe(true);
    });

    it('pushes a password change made while offline once the relay is reachable', async () => {
        const { runtime, sync, setup } = await loadModules();
        const { record, keys, lock } = await freshKeys('first-pw');
        await runtime.activateAppLock({ ...record, accountKeyVersion: 1 }, keys.dataKey);
        relay.lock = lock(1);

        relay.offline = true;
        await expect(setup.changeAppLockPassword('first-pw', 'second-pw')).resolves.toMatchObject({ ok: true });
        expect(runtime.getAppLockSnapshot().record).toMatchObject({ accountKeyVersion: 1, accountKeyPending: true });

        relay.offline = false;
        await sync.syncAppLockAccountLock();
        expect(relay.lock?.version).toBe(2);
        expect(runtime.getAppLockSnapshot().record).toMatchObject({ accountKeyVersion: 2, accountKeyPending: false });
    });

    it('refuses a password change based on a version another device already replaced', async () => {
        const { runtime, setup } = await loadModules();
        const { record, keys, lock } = await freshKeys('shared-pw');
        await runtime.activateAppLock({ ...record, accountKeyVersion: 1 }, keys.dataKey);
        relay.lock = lock(2);

        await expect(setup.changeAppLockPassword('shared-pw', 'my-new-pw')).resolves.toEqual({ ok: false, error: 'version_conflict' });
        expect(runtime.getAppLockSnapshot().record?.wrapped.passwordWrappedKey).toBe(record.wrapped.passwordWrappedKey);
        await expect(runtime.verifyAppLockPassword('shared-pw')).resolves.toBe(true);
    });

    it('requires the lock on a signed-in device that has none, unless that device was exempted', async () => {
        const { account, sync } = await loadModules();
        const { lock } = await freshKeys('some-pw');
        relay.lock = lock(1, true);

        await sync.syncAppLockAccountLock();
        expect(account.getAppLockAccountState()).toMatchObject({ required: true, exempt: false });
        expect(account.appLockAccountGateActive({ lockStatus: 'disabled', signedIn: true })).toBe(true);
        expect(account.appLockAccountGateActive({ lockStatus: 'disabled', signedIn: false })).toBe(false);
        expect(account.appLockAccountGateActive({ lockStatus: 'unlocked', signedIn: true })).toBe(false);

        await account.setAppLockDeviceExempt(true);
        expect(account.appLockAccountGateActive({ lockStatus: 'disabled', signedIn: true })).toBe(false);

        // The last value seen survives a restart, and an unreachable relay does not clear it.
        await account.setAppLockDeviceExempt(false);
        vi.resetModules();
        const restarted = await import('./appLockAccountState');
        await restarted.loadAppLockAccountState();
        expect(restarted.getAppLockAccountState().required).toBe(true);
    });

    it('joins with the account password: wrong password changes nothing, the right one seals this device', async () => {
        const { runtime, setup, TokenStorage } = await loadModules();
        const { lock } = await freshKeys('account-pw');
        relay.lock = lock(3);
        await TokenStorage.setCredentials({ token: 'token-join', secret: 'secret-join' });

        await expect(setup.joinAppLock('not-the-password')).resolves.toEqual({ ok: false, error: 'wrong_password' });
        expect(runtime.getAppLockSnapshot().status).toBe('disabled');
        expect(relay.registered).toHaveLength(0);

        await expect(setup.joinAppLock('account-pw')).resolves.toEqual({ ok: true });
        expect(runtime.getAppLockSnapshot()).toMatchObject({ status: 'unlocked', record: { accountKeyVersion: 3, email: 'owner@example.com' } });
        expect(relay.registered).toHaveLength(1);
        await expect(runtime.verifyAppLockPassword('account-pw')).resolves.toBe(true);
        await expect(TokenStorage.getCredentials()).resolves.toEqual({ token: 'token-join', secret: 'secret-join' });
        const stored = [...storage!.store.entries()].filter(([key]) => key.startsWith('auth_credentials')).map(([, value]) => value);
        expect(stored.some((value) => value.includes('token-join'))).toBe(false);
    });

    it('creates the account lock when turning the lock on, and leaves the device alone if another device was first', async () => {
        const { runtime, setup, account } = await loadModules();

        await expect(setup.enableAppLock({ email: 'owner@example.com', password: 'first-device' })).resolves.toEqual({ ok: true });
        expect(relay.lock).toMatchObject({ version: 1, required: true });
        expect(runtime.getAppLockSnapshot().record?.accountKeyVersion).toBe(1);
        expect(account.getAppLockAccountState().required).toBe(true);

        // A second device that believed it was first loses the race and is left without a lock.
        const second = await loadModulesFresh();
        await expect(second.setup.enableAppLock({ email: 'owner@example.com', password: 'second-device' }))
            .resolves.toEqual({ ok: false, error: 'version_conflict' });
        expect(second.runtime.getAppLockSnapshot().status).toBe('disabled');
        expect(relay.removed).toHaveLength(1);
    });

    async function loadModulesFresh() {
        storage?.restore();
        storage = installLocalStorageMock();
        vi.resetModules();
        return await loadModules();
    }
});
