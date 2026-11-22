import {
    apiAppLockAccountLockGet,
    apiAppLockAccountLockPut,
} from '@/sync/api/appLock/apiAppLockRecovery';

import { setAppLockAccountRequired } from './appLockAccountState';
import { getAppLockSnapshot, updateAppLockRecord } from './appLockRuntime';

/**
 * Brings this device in step with the account-wide lock. Runs after sign-in has booted (it needs the
 * relay) and when the app returns to the foreground.
 *
 * - Remembers whether the account requires the lock, which decides the gate on devices without one.
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
    await setAppLockAccountRequired(lock?.required === true);

    const record = getAppLockSnapshot().record;
    if (!record) return;

    if (record.accountKeyVersion === undefined) {
        if (lock) return;
        const created = await apiAppLockAccountLockPut({
            kdf: record.wrapped.kdf,
            passwordWrappedKey: record.wrapped.passwordWrappedKey,
            expectedVersion: null,
        });
        if (!created.ok) return;
        await updateAppLockRecord({ ...record, accountKeyVersion: created.version });
        await setAppLockAccountRequired(true);
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
    const pushed = await apiAppLockAccountLockPut({
        kdf: record.wrapped.kdf,
        passwordWrappedKey: record.wrapped.passwordWrappedKey,
        expectedVersion: record.accountKeyVersion,
    });
    if (pushed.ok) await updateAppLockRecord({ ...record, accountKeyVersion: pushed.version, accountKeyPending: false });
}
