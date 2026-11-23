import { TokenStorage } from '@/auth/storage/tokenStorage';
import { clearDeviceAccountData } from '@/auth/flows/clearDeviceAccountData';
import { encodeBase64 } from '@/encryption/base64';
import { getRandomBytes } from '@/platform/cryptoRandom';
import { getActiveServerUrl } from '@/sync/domains/server/serverProfiles';
import {
    apiAppLockAccountLockGet,
    apiAppLockAccountLockPut,
    apiAppLockMailSettingsGet,
    apiAppLockRecoveryRedeem,
    apiAppLockRecoveryRegister,
    apiAppLockRecoveryRemove,
    apiAppLockRecoveryRequestResetCode,
    type AppLockRecoveryResult,
} from '@/sync/api/appLock/apiAppLockRecovery';

import {
    createAppLockKeys,
    generateAppLockRecoveryKey,
    rewrapAppLockPassword,
    rewrapAppLockRecoveryKey,
} from './appLockCrypto';
import { setAppLockDeviceExempt } from './appLockAccountState';
import { unwrapAppLockKeyForAccountDevices, wrapAppLockKeyForAccountDevices } from './appLockAccountKey';
import { APP_LOCK_AUTO_LOCK_DEFAULT_MINUTES, type AppLockRecord } from './appLockRecord';
import {
    activateAppLock,
    deactivateAppLock,
    getAppLockDataKey,
    getAppLockSnapshot,
    unlockAppLockWithDataKey,
    unwrapAppLockDataKeyWithRecoveryKey,
    updateAppLockRecord,
    verifyAppLockPassword,
} from './appLockRuntime';
import { removeAppLockBiometricKey, storeAppLockBiometricKey } from './appLockBiometrics';

/**
 * Turns the lock on for this device. The lock record is saved first, so the data key stays
 * recoverable with the password; credentials are sealed afterwards. If that is interrupted, the
 * leftovers are plain (still readable) and `resealAppLockCredentials` seals them after the next unlock.
 */
export async function enableAppLockLocally(record: AppLockRecord, dataKey: Uint8Array): Promise<void> {
    await activateAppLock(record, dataKey);
    await TokenStorage.storeAllCredentialsAs('sealed');
}

/**
 * Turns the lock off for this device. Every credential is stored in plain form first, while the
 * lock record still wraps the data key; the record is removed only after all of them succeeded.
 * An interruption leaves the lock on with every credential still openable.
 */
export async function disableAppLockLocally(): Promise<void> {
    await TokenStorage.storeAllCredentialsAs('plain');
    await deactivateAppLock();
}

/**
 * Seals any credential left in plain form while the lock is on (an interrupted enable or disable,
 * or a sign-in written by a build without app lock). Runs after unlock; a no-op otherwise.
 */
export async function resealAppLockCredentials(): Promise<void> {
    if (!getAppLockDataKey()) return;
    await TokenStorage.storeAllCredentialsAs('sealed');
}

function newLockId(): string {
    return encodeBase64(getRandomBytes(18), 'base64url');
}

/**
 * Turns the lock on: creates the keys, escrows the recovery key with the relay under the recovery
 * email, then seals this device's credentials. Nothing changes on the device if the relay refuses
 * (for example when the account has no mail settings yet).
 */
export async function enableAppLock(params: Readonly<{ email: string; password: string }>): Promise<AppLockRecoveryResult> {
    const keys = await createAppLockKeys(params.password);
    const record: AppLockRecord = {
        v: 1,
        lockId: newLockId(),
        email: params.email.trim(),
        serverUrl: getActiveServerUrl(),
        wrapped: keys.wrapped,
        autoLockMinutes: APP_LOCK_AUTO_LOCK_DEFAULT_MINUTES,
        biometric: false,
    };
    const registered = await apiAppLockRecoveryRegister({ lockId: record.lockId, email: record.email, recoveryKey: keys.recoveryKey });
    if (!registered.ok) return registered;
    // The first device creates the account-wide lock; a device that loses that race is left without a lock.
    const deviceWrappedKey = await wrapAppLockKeyForAccountDevices(keys.dataKey);
    const created = deviceWrappedKey
        ? await apiAppLockAccountLockPut({
            kdf: keys.wrapped.kdf,
            passwordWrappedKey: keys.wrapped.passwordWrappedKey,
            deviceWrappedKey,
            expectedVersion: null,
        })
        : ({ ok: false, error: 'server' } as const);
    if (!created.ok) {
        await apiAppLockRecoveryRemove({ lockId: record.lockId });
        return created;
    }
    await enableAppLockLocally({ ...record, accountKeyVersion: created.version }, keys.dataKey);
    await setAppLockDeviceExempt(false);
    return { ok: true };
}

/**
 * Turns the account's existing lock on for this device, with no password: the shared data key is
 * unwrapped with the account's own secret, this device gets its own recovery escrow, and its sign-in is
 * sealed. The same password then unlocks it as on every other device. Runs by itself when the account
 * sync finds a lock, and from Settings after the owner turned the lock off here. Nothing changes if
 * this device cannot open the key or the relay refuses.
 */
export async function joinAppLock(): Promise<AppLockRecoveryResult> {
    const fetched = await apiAppLockAccountLockGet();
    if (!fetched.ok) return fetched;
    const { lock } = fetched;
    if (!lock) return { ok: false, error: 'not_found' };
    const dataKey = await unwrapAppLockKeyForAccountDevices(lock.deviceWrappedKey);
    if (!dataKey) return { ok: false, error: 'server' };

    const mail = await apiAppLockMailSettingsGet();
    if (!mail.ok) return mail;
    const email = mail.settings?.recoveryEmail?.trim();
    if (!email) return { ok: false, error: 'mail_not_configured' };

    const accountWrapped = { kdf: lock.kdf, passwordWrappedKey: lock.passwordWrappedKey, recoveryWrappedKey: '' };
    const recoveryKey = generateAppLockRecoveryKey();
    const record: AppLockRecord = {
        v: 1,
        lockId: newLockId(),
        email,
        serverUrl: getActiveServerUrl(),
        wrapped: await rewrapAppLockRecoveryKey(accountWrapped, dataKey, recoveryKey),
        autoLockMinutes: APP_LOCK_AUTO_LOCK_DEFAULT_MINUTES,
        biometric: false,
        accountKeyVersion: lock.version,
    };
    const registered = await apiAppLockRecoveryRegister({ lockId: record.lockId, email, recoveryKey });
    if (!registered.ok) return registered;
    await enableAppLockLocally(record, dataKey);
    await setAppLockDeviceExempt(false);
    return { ok: true };
}

/**
 * Changes the recovery email of an unlocked device: a fresh escrow under a new lock id replaces the
 * old one, which is removed once the new one is stored.
 */
export async function changeAppLockEmail(email: string): Promise<AppLockRecoveryResult> {
    const record = getAppLockSnapshot().record;
    const dataKey = getAppLockDataKey();
    if (!record || !dataKey) return { ok: false, error: 'not_found' };
    const recoveryKey = generateAppLockRecoveryKey();
    const lockId = newLockId();
    const trimmed = email.trim();
    const registered = await apiAppLockRecoveryRegister({ lockId, email: trimmed, recoveryKey });
    if (!registered.ok) return registered;
    await updateAppLockRecord({
        ...record,
        lockId,
        email: trimmed,
        serverUrl: getActiveServerUrl(),
        wrapped: await rewrapAppLockRecoveryKey(record.wrapped, dataKey, recoveryKey),
    });
    const removed = await apiAppLockRecoveryRemove({ lockId: record.lockId });
    if (!removed.ok) {
        console.error(`[appLock] Could not remove the previous recovery record from the relay (${removed.error}); it will stay unused.`);
    }
    return { ok: true };
}

/**
 * Changes the password everywhere: the same data key is re-wrapped and sent to the relay from the
 * version this device last saw, so other devices adopt it when they next connect. A change based on
 * a version another device already replaced is refused (`version_conflict`) and nothing changes. If
 * the relay cannot be reached, the change is kept on this device and sent later.
 */
export async function changeAppLockPassword(currentPassword: string, newPassword: string): Promise<AppLockRecoveryResult> {
    const record = getAppLockSnapshot().record;
    const dataKey = getAppLockDataKey();
    if (!record || !dataKey || !(await verifyAppLockPassword(currentPassword))) return { ok: false, error: 'wrong_password' };
    const wrapped = await rewrapAppLockPassword(record.wrapped, dataKey, newPassword);
    let next: AppLockRecord = { ...record, wrapped };
    if (record.accountKeyVersion !== undefined) {
        const deviceWrappedKey = await wrapAppLockKeyForAccountDevices(dataKey);
        const pushed = deviceWrappedKey
            ? await apiAppLockAccountLockPut({
                kdf: wrapped.kdf,
                passwordWrappedKey: wrapped.passwordWrappedKey,
                deviceWrappedKey,
                expectedVersion: record.accountKeyVersion,
            })
            : ({ ok: false, error: 'server' } as const);
        if (pushed.ok) next = { ...next, accountKeyVersion: pushed.version, accountKeyPending: false };
        else if (pushed.error === 'version_conflict') return pushed;
        else next = { ...next, accountKeyPending: true };
    }
    await updateAppLockRecord(next);
    return { ok: true };
}

/** Turns the lock off after checking the password. The relay escrow is removed when reachable. */
export async function turnOffAppLock(password: string): Promise<boolean> {
    const record = getAppLockSnapshot().record;
    if (!record || !(await verifyAppLockPassword(password))) return false;
    const removed = await apiAppLockRecoveryRemove({ lockId: record.lockId });
    if (!removed.ok) {
        console.error(`[appLock] Could not remove the recovery escrow from the relay (${removed.error}); it will stay unused.`);
    }
    await removeAppLockBiometricKey();
    await disableAppLockLocally();
    // This device is now an exception to the account's requirement; other devices keep their lock.
    await setAppLockDeviceExempt(true);
    return true;
}

export async function setAppLockAutoLockMinutes(minutes: number | null): Promise<void> {
    const record = getAppLockSnapshot().record;
    if (!record) return;
    await updateAppLockRecord({ ...record, autoLockMinutes: minutes });
}

/** Turns fingerprint unlock on (shows the system prompt) or off. */
export async function setAppLockBiometricEnabled(enabled: boolean, prompt: string): Promise<boolean> {
    const record = getAppLockSnapshot().record;
    const dataKey = getAppLockDataKey();
    if (!record) return false;
    if (!enabled) {
        await removeAppLockBiometricKey();
        await updateAppLockRecord({ ...record, biometric: false });
        return true;
    }
    if (!dataKey || !(await storeAppLockBiometricKey(dataKey, prompt))) return false;
    await updateAppLockRecord({ ...record, biometric: true });
    return true;
}

/** Lock screen: email a reset code to the recovery address. */
export async function requestAppLockResetCode(): Promise<AppLockRecoveryResult> {
    const record = getAppLockSnapshot().record;
    if (!record) return { ok: false, error: 'not_found' };
    return await apiAppLockRecoveryRequestResetCode(record.serverUrl, { lockId: record.lockId });
}

/** Lock screen: trade the emailed code for the recovery key, set a new password and unlock. */
export async function completeAppLockReset(code: string, newPassword: string): Promise<AppLockRecoveryResult> {
    const record = getAppLockSnapshot().record;
    if (!record) return { ok: false, error: 'not_found' };
    const redeemed = await apiAppLockRecoveryRedeem(record.serverUrl, { lockId: record.lockId, code });
    if (!redeemed.ok) return redeemed;
    const dataKey = await unwrapAppLockDataKeyWithRecoveryKey(redeemed.recoveryKey);
    if (!dataKey) return { ok: false, error: 'invalid_code' };
    // Sent to the relay by the account sync once this device has booted and can sign in.
    await updateAppLockRecord({
        ...record,
        wrapped: await rewrapAppLockPassword(record.wrapped, dataKey, newPassword),
        ...(record.accountKeyVersion !== undefined ? { accountKeyPending: true } : {}),
    });
    unlockAppLockWithDataKey(dataKey);
    return { ok: true };
}

/**
 * Lock screen escape hatch: forget the password by signing this device out. Account data and
 * credentials are removed and the lock is turned off; the device must be connected to the account
 * again. The relay escrow cannot be removed without credentials and simply stays unused.
 */
export async function signOutLockedDevice(): Promise<void> {
    await clearDeviceAccountData();
    await removeAppLockBiometricKey();
    await deactivateAppLock();
}
