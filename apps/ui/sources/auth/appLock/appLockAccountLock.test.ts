import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installTokenStorageWebPlatformMocks } from '@/auth/storage/tokenStorage.testHelpers';
import { installLocalStorageMock, type LocalStorageMockHandle } from '@/auth/storage/tokenStorage.web.testHelpers';

installTokenStorageWebPlatformMocks();

const FAST_KDF = { N: 2 ** 10, r: 8, p: 1 } as const;
const SERVER_URL = 'https://relay.example.test';

type FakeLock = { version: number; kdf: Record<string, unknown>; passwordWrappedKey: string; deviceWrappedKey: string };

// The relay is the network boundary: an in-memory stand-in that enforces the same version rule.
const relay = vi.hoisted(() => ({
    lock: null as FakeLock | null,
    offline: false,
    recoveryEmail: 'owner@example.com' as string | null,
    registered: [] as string[],
    removed: [] as string[],
}));

vi.mock('@/sync/api/appLock/apiAppLockRecovery', () => ({
    apiAppLockAccountLockGet: async () => (relay.offline ? { ok: false, error: 'network' } : { ok: true, lock: relay.lock }),
    apiAppLockAccountLockPut: async (request: { kdf: Record<string, unknown>; passwordWrappedKey: string; deviceWrappedKey: string; expectedVersion: number | null }) => {
        if (relay.offline) return { ok: false, error: 'network' };
        if (request.expectedVersion === null ? relay.lock !== null : relay.lock?.version !== request.expectedVersion) {
            return { ok: false, error: 'version_conflict' };
        }
        const version = (relay.lock?.version ?? 0) + 1;
        relay.lock = { version, kdf: request.kdf, passwordWrappedKey: request.passwordWrappedKey, deviceWrappedKey: request.deviceWrappedKey };
        return { ok: true, version };
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

function secretFor(byte: number): string {
    return Buffer.from(new Uint8Array(32).fill(byte)).toString('base64url');
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
        storage = installLocalStorageMock();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        storage?.restore();
        storage = null;
    });

    /** A signed-in device (plain sign-in, as before the lock exists) with the app-lock modules loaded. */
    async function signedInDevice(accountSecretByte = 7) {
        const { setServerUrl } = await import('@/sync/domains/server/serverConfig');
        setServerUrl(SERVER_URL);
        const runtime = await import('./appLockRuntime');
        const account = await import('./appLockAccountState');
        const sync = await import('./appLockAccountSync');
        const setup = await import('./appLockSetup');
        const accountKey = await import('./appLockAccountKey');
        const { TokenStorage } = await import('@/auth/storage/tokenStorage');
        await runtime.loadAppLock();
        await account.loadAppLockAccountState();
        await TokenStorage.setCredentials({ token: 'token-device', secret: secretFor(accountSecretByte) });
        return { runtime, account, sync, setup, accountKey, TokenStorage };
    }

    /** What another device of this account would have stored on the relay. */
    async function accountLockOnRelay(accountKey: Awaited<ReturnType<typeof signedInDevice>>['accountKey'], password: string, version = 1) {
        const { createAppLockKeys } = await import('./appLockCrypto');
        const keys = await createAppLockKeys(password, FAST_KDF);
        const deviceWrappedKey = await accountKey.wrapAppLockKeyForAccountDevices(keys.dataKey);
        relay.lock = { version, kdf: keys.wrapped.kdf, passwordWrappedKey: keys.wrapped.passwordWrappedKey, deviceWrappedKey: deviceWrappedKey! };
        return keys;
    }

    async function deviceRecord(password: string) {
        const { createAppLockKeys } = await import('./appLockCrypto');
        const keys = await createAppLockKeys(password, FAST_KDF);
        return {
            keys,
            record: {
                v: 1 as const,
                lockId: 'lock_0123456789abcdefghijkl',
                email: 'owner@example.com',
                serverUrl: SERVER_URL,
                wrapped: keys.wrapped,
                autoLockMinutes: 5,
                biometric: false,
            },
        };
    }

    it('turns an existing device lock into the account lock when the account has none', async () => {
        const { runtime, sync } = await signedInDevice();
        const { record, keys } = await deviceRecord('pw-legacy');
        await runtime.activateAppLock(record, keys.dataKey);

        await sync.syncAppLockAccountLock();

        expect(relay.lock).toMatchObject({ version: 1, passwordWrappedKey: record.wrapped.passwordWrappedKey });
        expect(relay.lock?.deviceWrappedKey).toBeTruthy();
        expect(runtime.getAppLockSnapshot().record?.accountKeyVersion).toBe(1);
    });

    it('turns the lock on by itself on a signed-in device when the account has a lock, with no password asked', async () => {
        const { runtime, sync, accountKey, TokenStorage } = await signedInDevice();
        await accountLockOnRelay(accountKey, 'account-pw', 3);

        await sync.syncAppLockAccountLock();

        expect(runtime.getAppLockSnapshot()).toMatchObject({ status: 'unlocked', record: { accountKeyVersion: 3, email: 'owner@example.com' } });
        expect(relay.registered).toHaveLength(1);
        // The same password unlocks it here, and the saved sign-in is sealed.
        await expect(runtime.verifyAppLockPassword('account-pw')).resolves.toBe(true);
        await expect(TokenStorage.getCredentials()).resolves.toEqual({ token: 'token-device', secret: secretFor(7) });
        const stored = [...storage!.store.entries()].filter(([key]) => key.startsWith('auth_credentials')).map(([, value]) => value);
        expect(stored.some((value) => value.includes('token-device'))).toBe(false);
    });

    it('leaves a device alone whose lock the owner turned off, until the owner turns it on again', async () => {
        const { runtime, sync, setup, accountKey, account } = await signedInDevice();
        await accountLockOnRelay(accountKey, 'account-pw');
        await account.setAppLockDeviceExempt(true);

        await sync.syncAppLockAccountLock();
        expect(runtime.getAppLockSnapshot().status).toBe('disabled');
        expect(relay.registered).toHaveLength(0);

        await expect(setup.joinAppLock()).resolves.toEqual({ ok: true });
        expect(runtime.getAppLockSnapshot().status).toBe('unlocked');
        expect(account.getAppLockAccountState().exempt).toBe(false);
    });

    it('does not turn the lock on when this device cannot open the account key', async () => {
        const { runtime, sync, setup, accountKey } = await signedInDevice(7);
        await accountLockOnRelay(accountKey, 'account-pw');
        // A different account secret cannot unwrap the device-wrapped key.
        await (await import('@/auth/storage/tokenStorage')).TokenStorage.setCredentials({ token: 'token-device', secret: secretFor(9) });

        await sync.syncAppLockAccountLock();
        expect(runtime.getAppLockSnapshot().status).toBe('disabled');
        await expect(setup.joinAppLock()).resolves.toMatchObject({ ok: false });
        expect(relay.registered).toHaveLength(0);
    });

    it('adopts a password changed on another device, and the old password stops working', async () => {
        const { runtime, sync } = await signedInDevice();
        const { record, keys } = await deviceRecord('old-password');
        await runtime.activateAppLock({ ...record, accountKeyVersion: 1 }, keys.dataKey);

        // Another device re-wrapped the same data key under a new password (version 2).
        const { rewrapAppLockPassword } = await import('./appLockCrypto');
        const rewrapped = await rewrapAppLockPassword(record.wrapped, keys.dataKey, 'new-password', FAST_KDF);
        relay.lock = { version: 2, kdf: rewrapped.kdf, passwordWrappedKey: rewrapped.passwordWrappedKey, deviceWrappedKey: 'ZGV2aWNl' };

        await sync.syncAppLockAccountLock();

        expect(runtime.getAppLockSnapshot().record?.accountKeyVersion).toBe(2);
        await expect(runtime.verifyAppLockPassword('old-password')).resolves.toBe(false);
        await expect(runtime.verifyAppLockPassword('new-password')).resolves.toBe(true);
    });

    it('pushes a password change made while offline once the relay is reachable', async () => {
        const { runtime, sync, setup, accountKey } = await signedInDevice();
        const { record, keys } = await deviceRecord('first-pw');
        await runtime.activateAppLock({ ...record, accountKeyVersion: 1 }, keys.dataKey);
        const deviceWrappedKey = await accountKey.wrapAppLockKeyForAccountDevices(keys.dataKey);
        relay.lock = { version: 1, kdf: keys.wrapped.kdf, passwordWrappedKey: keys.wrapped.passwordWrappedKey, deviceWrappedKey: deviceWrappedKey! };

        relay.offline = true;
        await expect(setup.changeAppLockPassword('first-pw', 'second-pw')).resolves.toMatchObject({ ok: true });
        expect(runtime.getAppLockSnapshot().record).toMatchObject({ accountKeyVersion: 1, accountKeyPending: true });

        relay.offline = false;
        await sync.syncAppLockAccountLock();
        expect(relay.lock?.version).toBe(2);
        expect(runtime.getAppLockSnapshot().record).toMatchObject({ accountKeyVersion: 2, accountKeyPending: false });
    });

    it('refuses a password change based on a version another device already replaced', async () => {
        const { runtime, setup, accountKey } = await signedInDevice();
        const { record, keys } = await deviceRecord('shared-pw');
        await runtime.activateAppLock({ ...record, accountKeyVersion: 1 }, keys.dataKey);
        await accountLockOnRelay(accountKey, 'someone-else', 2);

        await expect(setup.changeAppLockPassword('shared-pw', 'my-new-pw')).resolves.toEqual({ ok: false, error: 'version_conflict' });
        expect(runtime.getAppLockSnapshot().record?.wrapped.passwordWrappedKey).toBe(record.wrapped.passwordWrappedKey);
        await expect(runtime.verifyAppLockPassword('shared-pw')).resolves.toBe(true);
    });

    it('creates the account lock when turning the lock on, and leaves the device alone if another device was first', async () => {
        const first = await signedInDevice();
        await expect(first.setup.enableAppLock({ email: 'owner@example.com', password: 'first-device' })).resolves.toEqual({ ok: true });
        expect(relay.lock).toMatchObject({ version: 1 });
        expect(relay.lock?.deviceWrappedKey).toBeTruthy();
        expect(first.runtime.getAppLockSnapshot().record?.accountKeyVersion).toBe(1);

        // A second device that believed it was first loses the race and is left without a lock.
        storage?.restore();
        storage = installLocalStorageMock();
        vi.resetModules();
        const second = await signedInDevice();
        await expect(second.setup.enableAppLock({ email: 'owner@example.com', password: 'second-device' }))
            .resolves.toEqual({ ok: false, error: 'version_conflict' });
        expect(second.runtime.getAppLockSnapshot().status).toBe('disabled');
        expect(relay.removed).toHaveLength(1);
    });
});
