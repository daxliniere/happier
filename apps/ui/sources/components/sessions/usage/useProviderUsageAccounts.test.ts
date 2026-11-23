import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    AccountProfileSchema,
    ProviderAccountUsageSnapshotV1Schema,
    buildProviderAccountUsageRecordId,
    type ProviderAccountUsageSnapshotV1,
} from '@happier-dev/protocol';

import { createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';

import { buildProviderUsageAccountRequests, useProviderUsageAccounts } from './useProviderUsageAccounts';

// No signed-in account: quota views are not fetched in these tests.
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ credentials: null }) }));
// Native usage records are fetched from the server; tests supply the fetched records directly.
const nativeUsageRecords: { current: Record<string, ProviderAccountUsageSnapshotV1> } = { current: {} };
vi.mock('@/hooks/server/connectedServices/useProviderAccountUsageSnapshots', () => ({
    useProviderAccountUsageSnapshots: () => nativeUsageRecords.current,
}));

afterEach(() => { nativeUsageRecords.current = {}; standardCleanup(); });

function service(serviceId: string, profileIds: string[]) {
    return {
        serviceId,
        profiles: profileIds.map((profileId) => ({ profileId, status: 'connected', providerEmail: `${profileId}@example.test` })),
    } as never;
}

describe('buildProviderUsageAccountRequests', () => {
    it('lists connected logins in Settings order, then the native login, per provider', () => {
        const requests = buildProviderUsageAccountRequests({
            agentIds: ['claude', 'codex'],
            connectedServices: [service('anthropic', ['claude-10', 'claude-2']), service('openai-codex', ['work'])],
            nativeRecordIdsByAgent: new Map([['claude', ['paug_v1_nativeaa']]]),
        });
        expect(requests.map((request) => request.key)).toEqual([
            'claude:anthropic/claude-2',
            'claude:anthropic/claude-10',
            'claude:native',
            'codex:openai-codex/work',
        ]);
        expect(requests[0]?.providerEmail).toBe('claude-2@example.test');
        expect(requests[2]?.metadataRecordIds).toEqual(['paug_v1_nativeaa']);
    });

    it('never lists another provider\'s login for an agent that can borrow it', () => {
        const requests = buildProviderUsageAccountRequests({
            agentIds: ['opencode'],
            connectedServices: [service('anthropic', ['claude-1']), service('openai-codex', ['work'])],
            nativeRecordIdsByAgent: new Map(),
        });
        expect(requests).toEqual([{ key: 'opencode:default', agentId: 'opencode', profileRef: null, identified: false }]);
    });
});

describe('a native usage record that is really a connected login', () => {
    // The daemon stores a connected login's reading without a provider account id as a
    // provisional record that names the profile it came from.
    function usageRecord(subject: Readonly<{ kind: 'providerSubject' | 'provisionalLocalSubject'; id: string; mergeKey?: string }>) {
        const recordKey = {
            providerId: 'claude', accountSubjectId: subject.id,
            subjectKind: subject.kind === 'providerSubject' ? 'account' : 'unknown', quotaScope: 'account',
        } as const;
        const nowMs = Date.now();
        return ProviderAccountUsageSnapshotV1Schema.parse({
            v: 1, recordId: buildProviderAccountUsageRecordId(recordKey), recordKey, providerId: 'claude',
            accountSubject: subject, observedAtMs: nowMs, fetchedAtMs: nowMs, staleAfterMs: 600_000,
            source: 'connectedServiceProbe', confidence: 'confirmed', state: 'loaded_data', accountLabel: null,
            meters: [{ meterId: 'weekly', label: 'Weekly', used: 80, limit: 100, unit: 'count', utilizationPct: null,
                resetsAt: nowMs + 3_600_000, status: 'ok', details: {} }],
        });
    }
    async function listedAccounts(record: ProviderAccountUsageSnapshotV1) {
        const previous = storage.getState();
        nativeUsageRecords.current = { [record.recordId]: record };
        storage.setState({ isDataReady: true, sessions: {
            latest: createSessionFixture({ id: 'latest', metadata: {
                flavor: 'claude', path: '/repo', host: 'test',
                providerAccountUsageRefsV1: { v: 1, recordIds: [record.recordId], updatedAtMs: 1 },
            } as never }),
        } });
        const connectedServices = AccountProfileSchema.parse({ id: 'account', connectedServicesV2: [{
            serviceId: 'anthropic',
            profiles: [{ profileId: 'Claude1', status: 'connected' }, { profileId: 'Claude2', status: 'connected' }],
        }] }).connectedServicesV2;
        try {
            const hook = await renderHook(() => useProviderUsageAccounts({
                agentIds: ['claude'], connectedServices, windowMode: 'most_constrained', fetchEnabled: false,
            }));
            try {
                return hook.getCurrent().map((account) => account.profileRef?.profileId ?? 'native');
            } finally { await hook.unmount(); }
        } finally { storage.setState(previous); }
    }

    it('is listed once, as the connected login it came from', async () => {
        expect(await listedAccounts(usageRecord({
            kind: 'provisionalLocalSubject', id: 'legacy-connected-service:anthropic:Claude2', mergeKey: 'anthropic:Claude2',
        }))).toEqual(['Claude1', 'Claude2']);
    });

    it('is not listed when that connected login no longer exists', async () => {
        expect(await listedAccounts(usageRecord({
            kind: 'provisionalLocalSubject', id: 'legacy-connected-service:anthropic:Claude-2', mergeKey: 'anthropic:Claude-2',
        }))).toEqual(['Claude1', 'Claude2']);
    });

    it('still lists a genuine native login as its own account', async () => {
        expect(await listedAccounts(usageRecord({ kind: 'providerSubject', id: 'provider-account-3' })))
            .toEqual(['Claude1', 'Claude2', 'native']);
    });
});
