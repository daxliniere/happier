import { z } from 'zod';

/**
 * Wire contract for app-lock email recovery.
 *
 * A device that turns on its local app lock escrows a random recovery key with the relay server,
 * tied to a verified email address. When the owner forgets the password, the device asks the server
 * to email a one-time code and trades that code for the recovery key. The server never sees the
 * password or the device's credentials: the recovery key only unwraps the device-local data key.
 */
export const APP_LOCK_RECOVERY_ROUTES = Object.freeze({
    /** Authenticated: store or replace the escrow for a lock id and email a verification code. */
    register: '/v1/app-lock/recovery',
    /** Authenticated: confirm the email address with the verification code. */
    verifyEmail: '/v1/app-lock/recovery/verify',
    /** Authenticated: forget the escrow when the device turns its lock off. */
    remove: '/v1/app-lock/recovery/remove',
    /** Public: email a reset code to the verified address of a lock id. */
    requestResetCode: '/v1/app-lock/recovery/reset-code',
    /** Public: trade a valid reset code for the escrowed recovery key. */
    redeemResetCode: '/v1/app-lock/recovery/redeem',
});

/** Six-digit one-time code sent by email. */
export const APP_LOCK_RECOVERY_CODE_LENGTH = 6;

export const AppLockIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);
/** Base64 encoding of 32 random bytes. */
export const AppLockRecoveryKeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
export const AppLockRecoveryCodeSchema = z.string().regex(new RegExp(`^\\d{${APP_LOCK_RECOVERY_CODE_LENGTH}}$`));
export const AppLockRecoveryEmailSchema = z.string().trim().max(191).email(); // 191 = MySQL VARCHAR default used by the server schema.

export const AppLockRecoveryRegisterRequestSchema = z.object({
    lockId: AppLockIdSchema,
    email: AppLockRecoveryEmailSchema,
    recoveryKey: AppLockRecoveryKeySchema,
});
export type AppLockRecoveryRegisterRequest = z.infer<typeof AppLockRecoveryRegisterRequestSchema>;

export const AppLockRecoveryCodeRequestSchema = z.object({
    lockId: AppLockIdSchema,
    code: AppLockRecoveryCodeSchema,
});
export type AppLockRecoveryCodeRequest = z.infer<typeof AppLockRecoveryCodeRequestSchema>;

export const AppLockRecoveryLockRequestSchema = z.object({
    lockId: AppLockIdSchema,
});
export type AppLockRecoveryLockRequest = z.infer<typeof AppLockRecoveryLockRequestSchema>;

export const AppLockRecoveryOkResponseSchema = z.object({ ok: z.literal(true) });

export const AppLockRecoveryRedeemResponseSchema = z.object({
    recoveryKey: AppLockRecoveryKeySchema,
});
export type AppLockRecoveryRedeemResponse = z.infer<typeof AppLockRecoveryRedeemResponseSchema>;

export const APP_LOCK_RECOVERY_ERROR_CODES = [
    'invalid_code',
    'code_expired',
    'too_many_attempts',
    'cooldown',
    'not_found',
    'email_failed',
] as const;
export type AppLockRecoveryErrorCode = (typeof APP_LOCK_RECOVERY_ERROR_CODES)[number];

export const AppLockRecoveryErrorResponseSchema = z.object({
    error: z.enum(APP_LOCK_RECOVERY_ERROR_CODES),
    /** Seconds until another code may be requested, for `cooldown`. */
    retryAfterSeconds: z.number().int().nonnegative().optional(),
});
export type AppLockRecoveryErrorResponse = z.infer<typeof AppLockRecoveryErrorResponseSchema>;
