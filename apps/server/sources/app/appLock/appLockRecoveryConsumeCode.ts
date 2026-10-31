import { db } from "@/storage/db";
import type { AppLockRecoveryErrorCode } from "@happier-dev/protocol";
import {
    APP_LOCK_CODE_MAX_ATTEMPTS,
    CLEARED_APP_LOCK_CODE,
    checkAppLockCode,
    type AppLockCodePurpose,
    type AppLockCodeState,
} from "./appLockRecoveryCode";

/**
 * Spends one attempt on the active code and reports whether `code` matched it.
 *
 * The attempt is reserved with a conditional increment before the comparison, so parallel guesses
 * can never exceed the attempt budget. A matching code is cleared (single use); `onMatch` data is
 * written in the same update.
 */
export async function appLockRecoveryConsumeCode(
    record: AppLockCodeState,
    purpose: AppLockCodePurpose,
    code: string,
    now: Date,
    onMatch: Readonly<Record<string, unknown>> = {},
): Promise<"ok" | Extract<AppLockRecoveryErrorCode, "invalid_code" | "code_expired" | "too_many_attempts">> {
    const precheck = checkAppLockCode(record, purpose, code, now);
    if (precheck === "code_expired" || precheck === "too_many_attempts") return precheck;
    if (!record.codeHash || record.codePurpose !== purpose) return "invalid_code";

    const reserved = await db.appLockRecovery.updateMany({
        where: { id: record.id, codeHash: record.codeHash, codeAttempts: { lt: APP_LOCK_CODE_MAX_ATTEMPTS } },
        data: { codeAttempts: { increment: 1 } },
    });
    if (reserved.count === 0) return "too_many_attempts";
    if (precheck !== "ok") return "invalid_code";

    await db.appLockRecovery.update({
        where: { id: record.id },
        data: { ...CLEARED_APP_LOCK_CODE, ...onMatch },
    });
    return "ok";
}
