import { TokenStorage } from '@/auth/storage/tokenStorage';
import { clearDeviceAccountData } from '@/auth/flows/clearDeviceAccountData';
import { encodeBase64 } from '@/encryption/base64';
import { getRandomBytes } from '@/platform/cryptoRandom';
import { getActiveServerUrl } from '@/sync/domains/server/serverProfiles';
import {
    apiAppLockRecoveryRedeem,
    apiAppLockRecoveryRegister,
    apiAppLockRecoveryRemove,
    apiAppLockRecoveryRequestResetCode,
    apiAppLockRecoveryVerifyEmail,
    type AppLockRecoveryResult,
} from '@/sync/api/appLock/apiAppLockRecovery';

import {
    createAppLockKeys,
    generateAppLockRecoveryKey,
    rewrapAppLockPassword,
    rewrapAppLockRecoveryKey,
    type AppLockWrappedKeys,
} from './appLockCrypto';
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

/** Turns the lock on for this device and re-seals every stored credential with the data key. */
export async function enableAppLockLocally(record: AppLockRecord, dataKey: Uint8Array): Promise<void> {
    await TokenStorage.transitionCredentialStorage(() => activateAppLock(record, dataKey));
}

/** Turns the lock off for this device and stores credentials in plain form again. */
export async function disableAppLockLocally(): Promise<void> {
    await TokenStorage.transitionCredentialStorage(() => deactivateAppLock());
}

/**
 * An email address waiting for its verification code: either a first-time setup or a change of
 * recovery email on a device that is already locked. Nothing is stored on the device until the
 * code is confirmed.
 */
export type AppLockEnrollment = Readonly<{
    lockId: string;
    email: string;
    serverUrl: string;
    recoveryKey: string;
    dataKey: Uint8Array;
    wrapped: AppLockWrappedKeys;
    /** Present when replacing the recovery email of an existing lock. */
    replacesLockId: string | null;
}>;

function newLockId(): string {
    return encodeBase64(getRandomBytes(18), 'base64url');
}

async function register(enrollment: AppLockEnrollment): Promise<AppLockRecoveryResult> {
    return await apiAppLockRecoveryRegister({
        lockId: enrollment.lockId,
        email: enrollment.email,
        recoveryKey: enrollment.recoveryKey,
    });
}

/** First-time setup: creates the keys and emails a verification code. */
export async function startAppLockEnrollment(params: Readonly<{ email: string; password: string }>): Promise<
    AppLockRecoveryResult<{ enrollment: AppLockEnrollment }>
> {
    const keys = await createAppLockKeys(params.password);
    const enrollment: AppLockEnrollment = {
        lockId: newLockId(),
        email: params.email.trim(),
        serverUrl: getActiveServerUrl(),
        recoveryKey: keys.recoveryKey,
        dataKey: keys.dataKey,
        wrapped: keys.wrapped,
        replacesLockId: null,
    };
    const result = await register(enrollment);
    return result.ok ? { ok: true, enrollment } : result;
}

/** Changing the recovery email of an unlocked device: a fresh escrow, verified before it replaces the old one. */
export async function startAppLockEmailChange(email: string): Promise<AppLockRecoveryResult<{ enrollment: AppLockEnrollment }>> {
    const record = getAppLockSnapshot().record;
    const dataKey = getAppLockDataKey();
    if (!record || !dataKey) return { ok: false, error: 'not_found' };
    const recoveryKey = generateAppLockRecoveryKey();
    const enrollment: AppLockEnrollment = {
        lockId: newLockId(),
        email: email.trim(),
        serverUrl: getActiveServerUrl(),
        recoveryKey,
        dataKey,
        wrapped: await rewrapAppLockRecoveryKey(record.wrapped, dataKey, recoveryKey),
        replacesLockId: record.lockId,
    };
    const result = await register(enrollment);
    return result.ok ? { ok: true, enrollment } : result;
}

export async function resendAppLockEnrollmentCode(enrollment: AppLockEnrollment): Promise<AppLockRecoveryResult> {
    return await register(enrollment);
}

/** Confirms the email code, then turns the lock on (or switches the recovery email). */
export async function completeAppLockEnrollment(enrollment: AppLockEnrollment, code: string): Promise<AppLockRecoveryResult> {
    const verified = await apiAppLockRecoveryVerifyEmail({ lockId: enrollment.lockId, code });
    if (!verified.ok) return verified;

    const current = getAppLockSnapshot().record;
    if (enrollment.replacesLockId && current) {
        await updateAppLockRecord({
            ...current,
            lockId: enrollment.lockId,
            email: enrollment.email,
            serverUrl: enrollment.serverUrl,
            wrapped: enrollment.wrapped,
        });
        await apiAppLockRecoveryRemove({ lockId: enrollment.replacesLockId });
        return { ok: true };
    }

    await enableAppLockLocally({
        v: 1,
        lockId: enrollment.lockId,
        email: enrollment.email,
        serverUrl: enrollment.serverUrl,
        wrapped: enrollment.wrapped,
        autoLockMinutes: APP_LOCK_AUTO_LOCK_DEFAULT_MINUTES,
        biometric: false,
    }, enrollment.dataKey);
    return { ok: true };
}

export async function changeAppLockPassword(currentPassword: string, newPassword: string): Promise<boolean> {
    const record = getAppLockSnapshot().record;
    const dataKey = getAppLockDataKey();
    if (!record || !dataKey || !(await verifyAppLockPassword(currentPassword))) return false;
    await updateAppLockRecord({ ...record, wrapped: await rewrapAppLockPassword(record.wrapped, dataKey, newPassword) });
    return true;
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
    await updateAppLockRecord({ ...record, wrapped: await rewrapAppLockPassword(record.wrapped, dataKey, newPassword) });
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
