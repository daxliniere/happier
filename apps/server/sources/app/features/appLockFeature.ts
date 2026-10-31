import type { FeaturesPayloadDelta } from "./types";
import { readAppLockFeatureEnv } from "./catalog/readFeatureEnv";
import { readMailConfig } from "@/modules/mail/mailConfig";

/**
 * App-lock email recovery needs a way to send mail, so the gate is on only when the operator
 * has configured SMTP and has not switched the feature off.
 */
export function resolveAppLockFeature(env: NodeJS.ProcessEnv): FeaturesPayloadDelta {
    const config = readAppLockFeatureEnv(env);
    const enabled = config.emailRecoveryEnabled && readMailConfig(env) !== null;
    return {
        features: {
            appLock: {
                emailRecovery: { enabled },
            },
        },
    };
}
