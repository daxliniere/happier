import { db } from "@/storage/db";
import type { AppLockRecoveryLockRequest } from "@happier-dev/protocol";
import {
    CLEARED_APP_LOCK_CODE,
    appLockCodeCooldownSeconds,
    buildIssuedAppLockCode,
    emailAppLockCode,
    type AppLockResult,
} from "./appLockRecoveryCode";

/**
 * Public: emails a password-reset code to the verified address of a lock id. A locked device
 * cannot authenticate, so the unguessable lock id is the only identifier; the code itself only
 * reaches the owner's inbox. Unknown or unverified lock ids are reported as `not_found`.
 */
export async function appLockRecoveryRequestResetCode(
    input: AppLockRecoveryLockRequest,
    now: Date = new Date(),
): Promise<AppLockResult<{}>> {
    const record = await db.appLockRecovery.findUnique({ where: { id: input.lockId } });
    if (!record || !record.emailVerifiedAt) return { ok: false, error: "not_found" };
    const retryAfterSeconds = appLockCodeCooldownSeconds(record, now);
    if (retryAfterSeconds > 0) return { ok: false, error: "cooldown", retryAfterSeconds };

    const issued = buildIssuedAppLockCode(record.id, "reset", now);
    await db.appLockRecovery.update({ where: { id: record.id }, data: issued.data });

    if (!(await emailAppLockCode(record.email, "reset", issued.code))) {
        await db.appLockRecovery.update({
            where: { id: record.id },
            data: { ...CLEARED_APP_LOCK_CODE, codeSentAt: null },
        });
        return { ok: false, error: "email_failed" };
    }
    return { ok: true };
}
