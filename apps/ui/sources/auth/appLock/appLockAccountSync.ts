import {
    apiAppLockAccountLockGet,
    apiAppLockAccountLockPut,
} from '@/sync/api/appLock/apiAppLockRecovery';

import { wrapAppLockKeyForAccountDevices } from './appLockAccountKey';
import { getAppLockAccountState } from './appLockAccountState';
import { getAppLockDataKey, getAppLockSnapshot, updateAppLockRecord } from './appLockRuntime';
import { joinAppLock } from './appLockSetup';

/**
 * Brings this device in step with the account-wide lock. Runs after sign-in has booted (it needs the
 * relay) and when the app returns to the foreground.
 *
 * - A device without a lock turns it on by itself when the account has one, unless the owner turned
 *   it off on this device. No prompt: the shared key comes from the account's own secret.
 * - A lock turned on before the account-wide lock existed becomes the account lock if the account
 *   has none. If the account already has one, the old device lock is left as it is.
 * - A newer password wrapping on the relay replaces this device's copy (the data key is the same, so
 *   sealed sign-ins are unaffected); the old password stops working here.
 * - A password change that could not be sent earlier (offline, or after an email reset) is sent now.
 *   If the relay moved on in the meantime, the relay's version wins.
 *
 * An unreachable relay changes nothing.
 */
export async function syncAppLockAccountLock(): Promise<void> {
    const fetched = await apiAppLockAccountLockGet();
    if (!fetched.ok) return;
    const { lock } = fetched;

    const record = getAppLockSnapshot().record;
    if (!record) {
        if (lock && !getAppLockAccountState().exempt) await joinAppLock();
        return;
    }

    if (record.accountKeyVersion === undefined) {
        if (lock) return;
        const created = await pushPasswordWrapping(record, null);
        if (created !== null) await updateAppLockRecord({ ...record, accountKeyVersion: created });
        return;
    }
    if (!lock) return;

    if (lock.version > record.accountKeyVersion) {
        await updateAppLockRecord({
            ...record,
            wrapped: { ...record.wrapped, kdf: lock.kdf, passwordWrappedKey: lock.passwordWrappedKey },
            accountKeyVersion: lock.version,
            accountKeyPending: false,
        });
        return;
    }
    if (!record.accountKeyPending) return;
    const pushed = await pushPasswordWrapping(record, record.accountKeyVersion);
    if (pushed !== null) await updateAppLockRecord({ ...record, accountKeyVersion: pushed, accountKeyPending: false });
}

/** Sends this device's password wrapping to the relay; the new version, or null if it could not be sent. */
async function pushPasswordWrapping(
    record: NonNullable<ReturnType<typeof getAppLockSnapshot>['record']>,
    expectedVersion: number | null,
): Promise<number | null> {
    const dataKey = getAppLockDataKey();
    if (!dataKey) return null;
    const deviceWrappedKey = await wrapAppLockKeyForAccountDevices(dataKey);
    if (!deviceWrappedKey) return null;
    const result = await apiAppLockAccountLockPut({
        kdf: record.wrapped.kdf,
        passwordWrappedKey: record.wrapped.passwordWrappedKey,
        deviceWrappedKey,
        expectedVersion,
    });
    return result.ok ? result.version : null;
}
