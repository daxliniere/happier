import { z } from 'zod';

import { readAppLockStoredString, removeAppLockStoredString, writeAppLockStoredString } from './appLockStorage';

/**
 * The device-local app-lock record. It is never synced: the lock is a per-device setting.
 *
 * It holds only wrapped keys and preferences, never the password or the data key, so it lives next
 * to the credentials it protects (SecureStore on native, localStorage on web/desktop) and is
 * readable before unlock.
 */
export const AppLockRecordSchema = z.object({
    v: z.literal(1),
    /** Random id of this device's recovery escrow on the relay server. */
    lockId: z.string().min(1),
    email: z.string().min(1),
    /** Relay server that holds the recovery escrow. */
    serverUrl: z.string().min(1),
    wrapped: z.object({
        kdf: z.object({
            alg: z.literal('scrypt'),
            N: z.number().int().positive(),
            r: z.number().int().positive(),
            p: z.number().int().positive(),
            salt: z.string().min(1),
        }),
        passwordWrappedKey: z.string().min(1),
        recoveryWrappedKey: z.string().min(1),
    }),
    /** Minutes in the background before the app locks again; 0 = immediately, null = only on launch. */
    autoLockMinutes: z.number().int().min(0).nullable(),
    /** Fingerprint unlock is set up on this device (Android). */
    biometric: z.boolean(),
    /**
     * Version of the account-wide lock this record's password wrapping was last in step with. Absent
     * on a lock turned on before the account-wide lock existed.
     */
    accountKeyVersion: z.number().int().positive().optional(),
    /** A password change that has not reached the relay yet (made offline or after an email reset). */
    accountKeyPending: z.boolean().optional(),
});

export type AppLockRecord = z.infer<typeof AppLockRecordSchema>;

export const APP_LOCK_AUTO_LOCK_DEFAULT_MINUTES = 5;
export const APP_LOCK_AUTO_LOCK_CHOICES: readonly (number | null)[] = [0, 1, 5, 15, 60, null];

const RECORD_BASE_KEY = 'app_lock_v1';

export async function readAppLockRecord(): Promise<AppLockRecord | null> {
    const raw = await readAppLockStoredString(RECORD_BASE_KEY);
    if (!raw) return null;
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        json = null;
    }
    const parsed = AppLockRecordSchema.safeParse(json);
    if (!parsed.success) {
        // Fail closed: sealed credentials stay unreadable, so the device behaves as signed out.
        console.error('[appLock] Stored app lock settings are unreadable; treating the lock as off.');
        return null;
    }
    return parsed.data;
}

export async function writeAppLockRecord(record: AppLockRecord): Promise<void> {
    await writeAppLockStoredString(RECORD_BASE_KEY, JSON.stringify(AppLockRecordSchema.parse(record)));
}

export async function removeAppLockRecord(): Promise<void> {
    await removeAppLockStoredString(RECORD_BASE_KEY);
}
