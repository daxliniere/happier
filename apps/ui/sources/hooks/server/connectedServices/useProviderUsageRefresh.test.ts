import { beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects } from '@/dev/testkit';
import { runProviderUsageRefresh } from './useProviderUsageRefresh';
import { __resetConnectedServiceQuotaSnapshotStore } from '@/sync/domains/connectedServices/connectedServiceQuotaSnapshotStore';

// Provider refresh requests cross the server API boundary; orchestration and caches stay real.
const api = vi.hoisted(() => {
    const refuse = () => vi.fn<(credentials: unknown, params: unknown) => Promise<boolean>>(async () => false);
    return { quotaPlain: refuse(), quotaSealed: refuse(), accountPlain: refuse(), accountSealed: refuse() };
});
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV3', () => ({ requestConnectedServiceQuotaSnapshotRefreshV3: api.quotaPlain }));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV2', () => ({ requestConnectedServiceQuotaSnapshotRefresh: api.quotaSealed }));
vi.mock('@/sync/api/account/apiProviderAccountUsageV3', () => ({ requestProviderAccountUsageRefreshPlain: api.accountPlain }));
vi.mock('@/sync/api/account/apiProviderAccountUsageV2', () => ({ requestProviderAccountUsageRefreshSealed: api.accountSealed }));

describe('provider ring refresh', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        __resetConnectedServiceQuotaSnapshotStore();
    });
    it.each(['plain', 'e2ee'] as const)('refreshes all configured providers once through the %s transport', async (mode) => {
        const selected = { connectedProfileRef: { serviceId: 'anthropic', profileId: 'work' }, recordIds: ['paug_v1_abcdefgh'] };
        const context = {
            credentials: { token: 'test-token', secret: 'test-secret' }, credentialScope: 'test-scope',
            resolveAccountMode: async () => mode,
            configuredTargets: [
                selected,
                { connectedProfileRef: { serviceId: 'openai-codex', profileId: 'personal' }, recordIds: ['paug_v1_ijklmnop'] },
                selected,
            ],
        };
        runProviderUsageRefresh(context, selected);
        await flushHookEffects();
        const quotaRequests = mode === 'plain' ? api.quotaPlain : api.quotaSealed;
        const accountRequests = mode === 'plain' ? api.accountPlain : api.accountSealed;
        expect(quotaRequests.mock.calls.map((call) => call[1])).toEqual([
            { serviceId: 'anthropic', profileId: 'work' },
            { serviceId: 'openai-codex', profileId: 'personal' },
        ]);
        expect(accountRequests.mock.calls.map((call) => call[1])).toEqual([
            { recordId: 'paug_v1_abcdefgh' }, { recordId: 'paug_v1_ijklmnop' },
        ]);
    });
});
