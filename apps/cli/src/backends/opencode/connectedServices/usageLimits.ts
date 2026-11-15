import {
  buildConnectedServiceCredentialRecord,
  ConnectedServiceQuotaSnapshotV1Schema,
  type ConnectedServiceCredentialRecordV1,
  type ConnectedServiceQuotaSnapshotV1,
  type ProviderAccountUsageSnapshotV1,
} from '@happier-dev/protocol';
import { buildNativeProviderAccountUsageSourceProfileId } from '@/daemon/connectedServices/accountUsage/nativeSourceIdentity';
import { buildProviderAccountUsageSnapshotFromConnectedServiceQuotaObservation } from '@/daemon/connectedServices/accountUsage/fromConnectedServiceQuotaObservation';
import {
  ConnectedServiceQuotaFetchError,
  type ConnectedServiceQuotaFetcherDescriptor,
} from '@/daemon/connectedServices/quotas/types';
import {
  isLoopbackManagedOpenCodeBaseUrl,
  readSharedManagedOpenCodeServerStateBestEffort,
  type SharedManagedOpenCodeServerState,
} from '../server/sharedManagedServer';
import { resolveOpenCodeManagedServerStateCredential } from '../server/openCodeManagedServerCredential';
import { buildOpenCodeServerBasicAuthHeader } from '../server/openCodeServerAuth';

const OPEN_CODE_CONSOLE_SERVICE_ID = 'opencode-console' as const;
const OPEN_CODE_PROVIDER_ID = 'opencode';
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;

type UsageWindow = Readonly<{ percent?: unknown; limited?: unknown; resetsAt?: unknown }>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function usageData(raw: unknown): Record<string, unknown> | null {
  const root = asRecord(raw);
  if (!root) return null;
  return asRecord(root.data) ?? root;
}

function quotaMeter(meterId: string, label: string, window: UsageWindow | undefined) {
  if (!window) return null;
  const usedPct = finiteNumber(window.percent);
  if (usedPct === null || usedPct < 0 || usedPct > 100) return null;
  const resetsAt = finiteNumber(window.resetsAt);
  return {
    meterId,
    label,
    used: usedPct,
    limit: 100,
    remaining: 100 - usedPct,
    remainingPct: 100 - usedPct,
    usedPct,
    unit: 'unknown' as const,
    utilizationPct: usedPct,
    resetsAt: resetsAt !== null && resetsAt >= 0 ? Math.trunc(resetsAt) : null,
    status: 'ok' as const,
    isExhausted: window.limited === true || usedPct >= 100,
  };
}

export function mapOpenCodeUsageLimitsToQuotaSnapshot(input: Readonly<{
  raw: unknown;
  now: number;
  expectedWorkspaceId?: string | null;
  staleAfterMs?: number;
}>): ConnectedServiceQuotaSnapshotV1 | null {
  const data = usageData(input.raw);
  const workspace = asRecord(data?.workspace);
  const workspaceId = typeof workspace?.id === 'string' ? workspace.id.trim() : '';
  if (!workspaceId || (input.expectedWorkspaceId && workspaceId !== input.expectedWorkspaceId)) return null;

  const go = asRecord(data?.go);
  const meters = [
    quotaMeter('session', '5-hour', asRecord(go?.rolling) as UsageWindow | undefined),
    quotaMeter('weekly', 'Weekly', asRecord(go?.weekly) as UsageWindow | undefined),
    quotaMeter('monthly', 'Monthly', asRecord(go?.monthly) as UsageWindow | undefined),
  ].filter((meter): meter is NonNullable<typeof meter> => meter !== null);
  if (meters.length === 0) return null;

  const profileId = buildNativeProviderAccountUsageSourceProfileId({
    kind: 'providerSubject', providerId: OPEN_CODE_PROVIDER_ID, material: workspaceId,
  });
  return ConnectedServiceQuotaSnapshotV1Schema.parse({
    v: 1,
    serviceId: OPEN_CODE_CONSOLE_SERVICE_ID,
    profileId,
    fetchedAt: input.now,
    staleAfterMs: input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    planLabel: go ? 'OpenCode Go' : 'OpenCode Console',
    accountLabel: typeof workspace?.name === 'string' ? workspace.name : 'OpenCode Console',
    providerId: OPEN_CODE_PROVIDER_ID,
    activeAccountId: workspaceId,
    fetchedAtMs: input.now,
    staleAtMs: input.now + (input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS),
    source: 'provider_api',
    confidence: 'exact',
    meters,
  });
}

async function fetchOpenCodeUsageLimits(input: Readonly<{
  state: SharedManagedOpenCodeServerState;
  directory: string;
  now: number;
  signal: AbortSignal;
  expectedWorkspaceId?: string | null;
}>): Promise<ConnectedServiceQuotaSnapshotV1 | null> {
  const baseUrl = input.state.baseUrl.trim().replace(/\/+$/, '');
  if (!isLoopbackManagedOpenCodeBaseUrl(baseUrl)) return null;
  let endpoint: URL;
  try {
    endpoint = new URL('/api/experimental/usage/limits', `${baseUrl}/`);
  } catch {
    return null;
  }
  endpoint.searchParams.set('directory', input.directory);
  const stateCredential = resolveOpenCodeManagedServerStateCredential({ state: input.state, baseUrl });
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(stateCredential ? { Authorization: buildOpenCodeServerBasicAuthHeader(stateCredential) } : {}),
      },
      signal: input.signal,
    });
  } catch (error) {
    throw new ConnectedServiceQuotaFetchError('OpenCode usage request failed', { quotaFetchErrorCode: 'network' });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ConnectedServiceQuotaFetchError(`OpenCode usage request failed (${response.status})`, {
      status: response.status,
      quotaFetchErrorCode: response.status === 401 ? 'auth_failure' : 'provider_backoff',
    });
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ConnectedServiceQuotaFetchError('OpenCode usage response was malformed', { quotaFetchErrorCode: 'malformed' });
  }
  return mapOpenCodeUsageLimitsToQuotaSnapshot({
    raw,
    now: input.now,
    expectedWorkspaceId: input.expectedWorkspaceId,
  });
}

function nativeUsageCredential(snapshot: ProviderAccountUsageSnapshotV1, now: number): ConnectedServiceCredentialRecordV1 | null {
  if (snapshot.providerId !== OPEN_CODE_PROVIDER_ID || snapshot.recordKey.subjectKind !== 'account') return null;
  const workspaceId = snapshot.recordKey.accountSubjectId;
  return buildConnectedServiceCredentialRecord({
    now,
    serviceId: OPEN_CODE_CONSOLE_SERVICE_ID,
    profileId: buildNativeProviderAccountUsageSourceProfileId({
      kind: 'providerSubject', providerId: OPEN_CODE_PROVIDER_ID, material: workspaceId,
    }),
    kind: 'token',
    token: { token: 'local-managed-opencode-server', providerAccountId: workspaceId, providerEmail: null },
  });
}

export const openCodeConsoleQuotaFetcherDescriptor: ConnectedServiceQuotaFetcherDescriptor = {
  loadQuota: () => ({
    serviceId: OPEN_CODE_CONSOLE_SERVICE_ID,
    nativeUsageProviderId: OPEN_CODE_PROVIDER_ID,
    pollPolicy: { minPollIntervalMs: 5 * 60_000 },
    readNativeCredentialForUsage: async ({ snapshot, now }) => {
      const record = nativeUsageCredential(snapshot, now);
      return record ? { providerId: OPEN_CODE_PROVIDER_ID, record } : null;
    },
    fetch: async ({ record, now, signal }) => {
      if (record.serviceId !== OPEN_CODE_CONSOLE_SERVICE_ID || record.kind !== 'token') return null;
      const state = await readSharedManagedOpenCodeServerStateBestEffort();
      if (!state || state.status === 'failed' || state.status === 'starting') return null;
      return await fetchOpenCodeUsageLimits({
        state,
        directory: state.activeServerDir ?? process.cwd(),
        now,
        signal,
        expectedWorkspaceId: record.token.providerAccountId,
      });
    },
  }),
};

export async function fetchCurrentOpenCodeUsageSnapshot(input: Readonly<{
  directory: string;
  now: number;
  signal: AbortSignal;
}>): Promise<ProviderAccountUsageSnapshotV1 | null> {
  const state = await readSharedManagedOpenCodeServerStateBestEffort();
  if (!state || state.status === 'failed' || state.status === 'starting') return null;
  const quota = await fetchOpenCodeUsageLimits({ ...input, state });
  if (!quota?.activeAccountId) return null;
  const workspaceId = quota.activeAccountId;
  return buildProviderAccountUsageSnapshotFromConnectedServiceQuotaObservation({
    snapshot: { ...quota, providerId: OPEN_CODE_PROVIDER_ID, activeAccountId: workspaceId },
    sourceProviderAccountId: workspaceId,
  });
}
