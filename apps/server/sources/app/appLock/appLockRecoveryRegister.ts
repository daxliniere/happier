import { db } from "@/storage/db";
import type { AppLockRecoveryRegisterRequest } from "@happier-dev/protocol";
import {
    CLEARED_APP_LOCK_CODE,
    appLockCodeCooldownSeconds,
    buildIssuedAppLockCode,
    emailAppLockCode,
    type AppLockResult,
} from "./appLockRecoveryCode";

/**
 * Stores the recovery escrow for a device lock id owned by the caller and emails a verification
 * code. The escrow cannot be used for a reset until the email is verified.
 *
 * Retrying with the same lock id replaces the email and recovery key and sends a fresh code
 * (subject to the resend cooldown). Devices change their recovery email by registering a new
 * lock id and removing the old one once the new one is verified, so a verified escrow keeps
 * working until its replacement is confirmed. A lock id that belongs to another account is
 * reported as `not_found`.
 */
export async function appLockRecoveryRegister(
    ctx: { readonly uid: string },
    input: AppLockRecoveryRegisterRequest,
    now: Date = new Date(),
): Promise<AppLockResult<{}>> {
    const existing = await db.appLockRecovery.findUnique({ where: { id: input.lockId } });
    if (existing && existing.accountId !== ctx.uid) return { ok: false, error: "not_found" };
    if (existing) {
        const retryAfterSeconds = appLockCodeCooldownSeconds(existing, now);
        if (retryAfterSeconds > 0) return { ok: false, error: "cooldown", retryAfterSeconds };
    }

    const issued = buildIssuedAppLockCode(input.lockId, "verify", now);
    await db.appLockRecovery.upsert({
        where: { id: input.lockId },
        create: {
            id: input.lockId,
            accountId: ctx.uid,
            email: input.email,
            recoveryKey: input.recoveryKey,
            emailVerifiedAt: null,
            ...issued.data,
        },
        update: {
            email: input.email,
            recoveryKey: input.recoveryKey,
            emailVerifiedAt: null,
            ...issued.data,
        },
    });

    if (!(await emailAppLockCode(input.email, "verify", issued.code))) {
        await db.appLockRecovery.update({
            where: { id: input.lockId },
            data: { ...CLEARED_APP_LOCK_CODE, codeSentAt: null },
        });
        return { ok: false, error: "email_failed" };
    }
    return { ok: true };
}
