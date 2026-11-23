import { describe, expect, it, vi, beforeEach } from 'vitest';

import { renderHook } from '@/dev/testkit/hooks/renderHook';

const gaugeMock = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/server/connectedServices/useProviderUsageGauge', () => ({
    useProviderUsageGauge: (params: unknown) => gaugeMock(params),
}));
vi.mock('@/sync/store/hooks', () => ({
    useProfile: () => ({ connectedServicesV2: [] }),
}));

import type { SessionRuntimeIssueV1 } from '@happier-dev/protocol';

import { useSelectedAccountClearsUsageLimit } from './useSelectedAccountClearsUsageLimit';

const issueFor = (profileId: string): SessionRuntimeIssueV1 => ({
    v: 1, scope: 'primary_session', status: 'failed', code: 'usage_limit', source: 'usage_limit', occurredAt: 1, provider: 'claude',
    usageLimit: {
        v: 1, resetAtMs: 5_000, retryAfterMs: null, quotaScope: 'account', recoverability: 'wait',
        connectedService: { serviceId: 'claude-subscription', profileId, groupId: null },
    },
} as SessionRuntimeIssueV1);

const metadataBoundTo = (profileId: string) => ({
    connectedServices: { v: 1, bindingsByServiceId: { 'claude-subscription': { source: 'connected', selection: 'profile', profileId } } },
}) as never;

const gaugeFor = (profileId: string, rows: number[], isStale = false) => ({
    gauge: { sourceProfileId: profileId, isStale, allMeterRows: rows.map((remainingPct) => ({ remainingPct })) },
});

describe('useSelectedAccountClearsUsageLimit', () => {
    beforeEach(() => gaugeMock.mockReset());

    it('is true when the limit was hit by another account and the selected one has capacity', async () => {
        gaugeMock.mockReturnValue(gaugeFor('Claude2', [18, 24]));

        const hook = await renderHook(() => useSelectedAccountClearsUsageLimit({
            metadata: metadataBoundTo('Claude2'), agentId: 'claude', issue: issueFor('Claude1'),
        }));

        expect(hook.getCurrent()).toBe(true);
        expect(gaugeMock).toHaveBeenCalledWith(expect.objectContaining({
            providerId: 'claude',
            profileRef: expect.objectContaining({ serviceId: 'claude-subscription', profileId: 'Claude2' }),
        }));
    });

    it('does not fetch or claim anything when the selected account is the one that hit the limit', async () => {
        gaugeMock.mockReturnValue(gaugeFor('Claude2', [18]));

        const hook = await renderHook(() => useSelectedAccountClearsUsageLimit({
            metadata: metadataBoundTo('Claude2'), agentId: 'claude', issue: issueFor('Claude2'),
        }));

        expect(hook.getCurrent()).toBe(false);
        expect(gaugeMock).toHaveBeenCalledWith(expect.objectContaining({ profileRef: null }));
    });

    it('is false while the selected account is exhausted', async () => {
        gaugeMock.mockReturnValue(gaugeFor('Claude2', [0, 24]));

        const hook = await renderHook(() => useSelectedAccountClearsUsageLimit({
            metadata: metadataBoundTo('Claude2'), agentId: 'claude', issue: issueFor('Claude1'),
        }));

        expect(hook.getCurrent()).toBe(false);
    });

    it('is false when no figures are available for the selected account yet', async () => {
        gaugeMock.mockReturnValue({ gauge: null });

        const hook = await renderHook(() => useSelectedAccountClearsUsageLimit({
            metadata: metadataBoundTo('Claude2'), agentId: 'claude', issue: issueFor('Claude1'),
        }));

        expect(hook.getCurrent()).toBe(false);
    });
});
