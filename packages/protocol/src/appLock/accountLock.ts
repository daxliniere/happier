import { z } from 'zod';

/**
 * Account-wide app lock.
 *
 * One shared data key seals the saved sign-in on every device of the account. The relay stores that
 * key in two wrapped forms and never sees it in the clear:
 *
 * - `passwordWrappedKey` under `kdf`: what a device unlocks with the lock password. Changing the
 *   password re-wraps the same key and bumps `version`; devices adopt a newer version when they next
 *   reach the relay.
 * - `deviceWrappedKey` under a key derived from the account's own secret, which every signed-in device
 *   holds. A device that signs in uses it to turn the lock on by itself, with no prompt.
 *
 * Anyone holding a valid account token can fetch `passwordWrappedKey` and guess the password offline,
 * so a short password is only as strong as it is. `deviceWrappedKey` needs the account secret.
 */
export const APP_LOCK_ACCOUNT_LOCK_ROUTES = Object.freeze({
    /** Authenticated: GET the account's lock (or null) / PUT a new or re-wrapped key. */
    accountLock: '/v1/app-lock/account-lock',
});

export const AppLockKdfSchema = z.object({
    alg: z.literal('scrypt'),
    N: z.number().int().positive(),
    r: z.number().int().positive(),
    p: z.number().int().positive(),
    salt: z.string().min(1).max(64),
});
export type AppLockKdf = z.infer<typeof AppLockKdfSchema>;

export const AppLockAccountLockSchema = z.object({
    /** Starts at 1 and increases by one on every re-wrap. */
    version: z.number().int().positive(),
    kdf: AppLockKdfSchema,
    passwordWrappedKey: z.string().min(1).max(256),
    deviceWrappedKey: z.string().min(1).max(256),
});
export type AppLockAccountLock = z.infer<typeof AppLockAccountLockSchema>;

export const AppLockAccountLockResponseSchema = z.object({
    lock: AppLockAccountLockSchema.nullable(),
});
export type AppLockAccountLockResponse = z.infer<typeof AppLockAccountLockResponseSchema>;

export const AppLockAccountLockPutRequestSchema = z.object({
    kdf: AppLockKdfSchema,
    passwordWrappedKey: z.string().min(1).max(256),
    deviceWrappedKey: z.string().min(1).max(256),
    /** The version the caller based this key on; `null` creates the account lock and fails if one exists. */
    expectedVersion: z.number().int().positive().nullable(),
});
export type AppLockAccountLockPutRequest = z.infer<typeof AppLockAccountLockPutRequestSchema>;

export const AppLockAccountLockPutResponseSchema = z.object({
    version: z.number().int().positive(),
});
export type AppLockAccountLockPutResponse = z.infer<typeof AppLockAccountLockPutResponseSchema>;
