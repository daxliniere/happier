import type { SessionRuntimeIssueV1 } from '@happier-dev/protocol';

import { classifyPrimarySessionRuntimeIssue } from '@/agent/runtime/session/errors/classifyPrimarySessionRuntimeIssue';
import { classifyCodexConnectedServiceAuthFailure } from '../connectedServices/classifyCodexConnectedServiceAuthFailure';
import { readCodexProviderErrorRecord } from '../utils/readCodexProviderErrorRecord';

/** Codex stores the provider's HTTP error body as a JSON string in `task_complete.error.message`. */
function readEmbeddedProviderError(error: Record<string, unknown>): Record<string, unknown> {
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    if (!message.startsWith('{')) return error;
    try {
        return readCodexProviderErrorRecord(JSON.parse(message)) ?? error;
    } catch {
        return error;
    }
}

/**
 * Classifies a provider turn failure recorded in a Codex rollout through the same owners the
 * app-server runner uses, so transcript notices match the session's runtime issue.
 */
export function classifyCodexRolloutTurnFailure(params: Readonly<{
    error: Record<string, unknown>;
    providerTurnId: string | null;
    occurredAt: number;
}>): SessionRuntimeIssueV1 {
    const providerError = readEmbeddedProviderError(params.error);
    const runtimeAuthClassification = classifyCodexConnectedServiceAuthFailure({
        providerErrorPath: true,
        error: providerError,
        serviceId: 'openai-codex',
        profileId: null,
        groupId: null,
    });
    return classifyPrimarySessionRuntimeIssue({
        provider: 'codex',
        cause: 'status_error',
        error: runtimeAuthClassification ? { ...providerError, runtimeAuthClassification } : providerError,
        providerTurnId: params.providerTurnId,
        occurredAt: params.occurredAt,
    });
}
