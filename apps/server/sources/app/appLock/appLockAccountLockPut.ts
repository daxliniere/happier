import type { AppLockAccountLockPutRequest } from "@happier-dev/protocol";
import { db } from "@/storage/db";
import type { AppLockResult } from "./appLockRecoveryCode";

/**
 * Creates or re-wraps the caller's account-wide app lock.
 *
 * `expectedVersion: null` creates it and fails with `version_conflict` if one exists, so two
 * devices turning the lock on at the same time cannot both claim to be first. A number re-wraps the
 * key only while the stored version still equals it, in one conditional write, so a device that
 * missed a password change made elsewhere is refused instead of overwriting it.
 */
export async function appLockAccountLockPut(
    ctx: { readonly uid: string },
    input: AppLockAccountLockPutRequest,
): Promise<AppLockResult<{ readonly version: number }>> {
    const kdf = JSON.stringify(input.kdf);
    if (input.expectedVersion === null) {
        try {
            await db.appLockAccountLock.create({
                data: { accountId: ctx.uid, kdf, passwordWrappedKey: input.passwordWrappedKey },
            });
        } catch {
            const existing = await db.appLockAccountLock.findUnique({ where: { accountId: ctx.uid }, select: { accountId: true } });
            if (existing) return { ok: false, error: "version_conflict" };
            throw new Error("Failed to create the app lock account record");
        }
        return { ok: true, version: 1 };
    }
    const updated = await db.appLockAccountLock.updateMany({
        where: { accountId: ctx.uid, version: input.expectedVersion },
        data: { kdf, passwordWrappedKey: input.passwordWrappedKey, version: { increment: 1 } },
    });
    if (updated.count === 0) return { ok: false, error: "version_conflict" };
    return { ok: true, version: input.expectedVersion + 1 };
}
