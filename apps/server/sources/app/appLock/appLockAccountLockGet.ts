import { AppLockKdfSchema, type AppLockAccountLock } from "@happier-dev/protocol";
import { db } from "@/storage/db";

/** The caller's account-wide app lock (password-wrapped key and settings), or null when unset. */
export async function appLockAccountLockGet(ctx: { readonly uid: string }): Promise<AppLockAccountLock | null> {
    const row = await db.appLockAccountLock.findUnique({ where: { accountId: ctx.uid } });
    if (!row) return null;
    return {
        version: row.version,
        kdf: AppLockKdfSchema.parse(JSON.parse(row.kdf)),
        passwordWrappedKey: row.passwordWrappedKey,
        deviceWrappedKey: row.deviceWrappedKey,
    };
}
