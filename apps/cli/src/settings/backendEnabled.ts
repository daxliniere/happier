import {
  buildBackendTargetKey,
  SPAWN_SESSION_ERROR_CODES,
  type BackendTargetRefV1,
} from '@happier-dev/protocol';
import type { AgentId } from '@happier-dev/agents';

export function isBackendEnabledByAccountSettings(params: Readonly<{
  agentId?: AgentId;
  backendTarget?: BackendTargetRefV1;
  settings: Record<string, unknown>;
}>): boolean {
  const backendEnabledByTargetKey = params.settings.backendEnabledByTargetKey;
  if (!backendEnabledByTargetKey || typeof backendEnabledByTargetKey !== 'object' || Array.isArray(backendEnabledByTargetKey)) return true;

  const backendTarget = params.backendTarget
    ?? (params.agentId ? ({ kind: 'builtInAgent', agentId: params.agentId } as const satisfies BackendTargetRefV1) : null);
  if (!backendTarget) return true;

  return (backendEnabledByTargetKey as Record<string, unknown>)[buildBackendTargetKey(backendTarget)] !== false;
}

export function assertBackendEnabledByAccountSettings(params: Readonly<{
  agentId?: AgentId;
  backendTarget?: BackendTargetRefV1;
  settings: Record<string, unknown>;
}>): void {
  const backendTarget = params.backendTarget
    ?? (params.agentId ? ({ kind: 'builtInAgent', agentId: params.agentId } as const satisfies BackendTargetRefV1) : null);
  if (!backendTarget) return;
  if (!isBackendEnabledByAccountSettings(params)) {
    const label = backendTarget.kind === 'configuredAcpBackend' ? backendTarget.backendId : backendTarget.agentId;
    throw new Error(`${label} is disabled in your account settings (enable it in the UI provider settings).`);
  }
}

export type BackendDisabledSpawnError = Readonly<{
  type: 'error';
  errorCode: typeof SPAWN_SESSION_ERROR_CODES.BACKEND_DISABLED;
  errorMessage: string;
}>;

/**
 * Spawn-admission form of the disable check: returns a structured BACKEND_DISABLED spawn
 * error for an explicitly requested, disabled backend target, or null when the spawn may
 * proceed (target absent, settings unavailable, or backend enabled).
 */
export function resolveBackendDisabledSpawnError(params: Readonly<{
  backendTarget: BackendTargetRefV1 | undefined;
  settings: Record<string, unknown> | undefined;
}>): BackendDisabledSpawnError | null {
  const backendTarget = params.backendTarget;
  if (!backendTarget || !params.settings) return null;
  if (isBackendEnabledByAccountSettings({ backendTarget, settings: params.settings })) return null;
  const label = backendTarget.kind === 'configuredAcpBackend' ? backendTarget.backendId : backendTarget.agentId;
  return {
    type: 'error',
    errorCode: SPAWN_SESSION_ERROR_CODES.BACKEND_DISABLED,
    errorMessage: `${label} is disabled in your account settings (enable it in the UI provider settings).`,
  };
}
