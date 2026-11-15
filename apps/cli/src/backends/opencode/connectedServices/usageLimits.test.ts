import { describe, expect, it } from 'vitest';

import { buildProviderAccountUsageSnapshotFromConnectedServiceQuotaObservation } from '@/daemon/connectedServices/accountUsage/fromConnectedServiceQuotaObservation';
import { mapOpenCodeUsageLimitsToQuotaSnapshot, openCodeConsoleQuotaFetcherDescriptor } from './usageLimits';

describe('mapOpenCodeUsageLimitsToQuotaSnapshot', () => {
  it('maps OpenCode Go windows into native provider quota meters', () => {
    const snapshot = mapOpenCodeUsageLimitsToQuotaSnapshot({
      raw: {
        data: {
          workspace: { id: 'wrk_test', name: 'Personal' },
          go: {
            rolling: { percent: 30, limited: false, resetsAt: 2_000 },
            weekly: { percent: 58, limited: false, resetsAt: 3_000 },
            monthly: { percent: 100, limited: true, resetsAt: 4_000 },
          },
          budgets: [],
        },
      },
      now: 1_000,
    });

    expect(snapshot?.serviceId).toBe('opencode-console');
    expect(snapshot?.providerId).toBe('opencode');
    expect(snapshot?.activeAccountId).toBe('wrk_test');
    expect(snapshot?.meters.map((meter) => [meter.meterId, meter.utilizationPct, meter.remainingPct])).toEqual([
      ['session', 30, 70],
      ['weekly', 58, 42],
      ['monthly', 100, 0],
    ]);
    expect(snapshot?.meters[2]?.isExhausted).toBe(true);
  });

  it('keeps an exhausted window with zero remaining and rejects a different account', () => {
    const raw = {
      workspace: { id: 'wrk_test', name: 'Personal' },
      go: { rolling: { percent: 100, limited: true, resetsAt: 2_000 } },
    };

    expect(mapOpenCodeUsageLimitsToQuotaSnapshot({ raw, now: 1_000 })?.meters[0]?.remainingPct).toBe(0);
    expect(mapOpenCodeUsageLimitsToQuotaSnapshot({
      raw,
      now: 1_000,
      expectedWorkspaceId: 'wrk_other',
    })).toBeNull();
  });

  it('returns no quota when the account has no supported usage windows', () => {
    expect(mapOpenCodeUsageLimitsToQuotaSnapshot({
      raw: { workspace: { id: 'wrk_test', name: 'Personal' }, budgets: [] },
      now: 1_000,
    })).toBeNull();
  });

  it('refreshes only the same OpenCode Console account through the native usage path', async () => {
    const quota = mapOpenCodeUsageLimitsToQuotaSnapshot({
      raw: {
        workspace: { id: 'wrk_test', name: 'Personal' },
        go: { rolling: { percent: 30, limited: false, resetsAt: 2_000 } },
      },
      now: 1_000,
    });
    expect(quota).not.toBeNull();
    const snapshot = buildProviderAccountUsageSnapshotFromConnectedServiceQuotaObservation({
      snapshot: quota!,
      sourceProviderAccountId: 'wrk_test',
    });
    const fetcher = openCodeConsoleQuotaFetcherDescriptor.loadQuota?.({ env: {}, staleAfterMs: 300_000 });
    const native = await fetcher?.readNativeCredentialForUsage?.({
      snapshot,
      now: 1_000,
      signal: AbortSignal.timeout(1_000),
    });

    expect(native?.providerId).toBe('opencode');
    expect(native?.record.serviceId).toBe('opencode-console');
    expect(native?.record.kind === 'token' ? native.record.token.providerAccountId : null).toBe('wrk_test');
  });
});
