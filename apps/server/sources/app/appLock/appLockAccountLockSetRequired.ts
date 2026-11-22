import { db } from "@/storage/db";
import type { AppLockResult } from "./appLockRecoveryCode";

/** Sets whether devices without the lock must set it up. `not_found` when the account has no lock. */
export async function appLockAccountLockSetRequired(
    ctx: { readonly uid: string },
    required: boolean,
): Promise<AppLockResult<{}>> {
    const updated = await db.appLockAccountLock.updateMany({ where: { accountId: ctx.uid }, data: { required } });
    return updated.count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}
