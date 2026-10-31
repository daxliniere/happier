import { db } from "@/storage/db";
import type { AppLockRecoveryCodeRequest } from "@happier-dev/protocol";
import { appLockRecoveryConsumeCode } from "./appLockRecoveryConsumeCode";
import type { AppLockResult } from "./appLockRecoveryCode";

/**
 * Confirms the recovery email of the caller's lock id with the verification code, which makes
 * the escrow usable for password resets.
 */
export async function appLockRecoveryVerifyEmail(
    ctx: { readonly uid: string },
    input: AppLockRecoveryCodeRequest,
    now: Date = new Date(),
): Promise<AppLockResult<{}>> {
    const record = await db.appLockRecovery.findFirst({ where: { id: input.lockId, accountId: ctx.uid } });
    if (!record) return { ok: false, error: "not_found" };
    const verdict = await appLockRecoveryConsumeCode(record, "verify", input.code, now, { emailVerifiedAt: now });
    return verdict === "ok" ? { ok: true } : { ok: false, error: verdict };
}
