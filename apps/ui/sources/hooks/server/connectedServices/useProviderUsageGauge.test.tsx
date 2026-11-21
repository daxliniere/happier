import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { AccountProfileSchema, buildProviderAccountUsageRecordId, ProviderAccountUsageSnapshotV1Schema } from '@happier-dev/protocol';
import { createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { resolveAuthCredentialsScopeKey } from '@/auth/storage/resolveAuthCredentialsScopeKey';
import { writeProviderAccountUsageSnapshotToCache, __resetProviderAccountUsageSnapshotCache } from '@/sync/domains/connectedServices/accountUsage/cache';
import { useProviderUsageGauge } from './useProviderUsageGauge';
import { useProviderUsageGauges } from '@/components/sessions/usage/useProviderUsageGauges';

const credentials = { token: 'test', secret: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url') };
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ credentials }) }));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => true }));

afterEach(() => { standardCleanup(); __resetProviderAccountUsageSnapshotCache(); });

describe('useProviderUsageGauge native usage discovery', () => {
    it('keeps a native login and a connected profile as separate accounts, never lending one\'s figures to the other', async () => {
        const previous = storage.getState();
        const connectedServicesV2 = AccountProfileSchema.parse({ id: 'account', connectedServicesV2: [{
            serviceId: 'openai-codex', profiles: [{ profileId: 'work', status: 'connected' }],
        }] }).connectedServicesV2;
        const recordKey = { providerId: 'codex', accountSubjectId: 'personal-login', subjectKind: 'account', quotaScope: 'account' } as const;
        const snapshot = ProviderAccountUsageSnapshotV1Schema.parse({
            v: 1, recordId: buildProviderAccountUsageRecordId(recordKey), recordKey, providerId: 'codex',
            accountSubject: { kind: 'providerSubject', id: 'personal-login' },
            observedAtMs: Date.now(), fetchedAtMs: Date.now(), staleAfterMs: 60_000,
            source: 'providerHttp', confidence: 'confirmed', state: 'loaded_data',
            meters: [{ meterId: 'weekly', label: 'Weekly', used: 100, limit: 100, unit: 'count',
                utilizationPct: null, remainingPct: null, resetsAt: null, status: 'ok',
                details: { limitCategory: 'usage_limit' } }],
        });
        writeProviderAccountUsageSnapshotToCache({ credentialScope: resolveAuthCredentialsScopeKey(credentials), snapshot });
        storage.setState({ isDataReady: true, profile: AccountProfileSchema.parse({ id: 'account', connectedServicesV2 }),
            sessions: { personal: createSessionFixture({ id: 'personal', metadata: { flavor: 'codex', path: '/repo', host: 'test',
                providerAccountUsageRefsV1: { v: 1, recordIds: [snapshot.recordId], updatedAtMs: Date.now() } } as never }) } });
        try {
            const hook = await renderHook(() => useProviderUsageGauges({
                agentIds: ['codex'], accountProfileConnectedServicesV2: connectedServicesV2,
                windowMode: 'most_constrained', fetchEnabled: false,
            }));
            try {
                const accounts = hook.getCurrent().accounts;
                expect(accounts.map((account) => [account.profileRef?.profileId ?? 'native', account.label])).toEqual([
                    ['work', 'Codex 1'],
                    ['native', 'Codex 2'],
                ]);
                // The connected profile has no quota snapshot of its own, so it stays without figures.
                expect(accounts[0]?.gauge).toBeNull();
                expect(accounts[1]?.gauge?.remainingPct).toBe(0);
            } finally { await hook.unmount(); }
        } finally { storage.setState(previous); }
    });

    it.each(['claude', 'codex', 'opencode'] as const)('publishes the same cached %s account observation to the HUD and composer', async (providerId) => {
        const previous = storage.getState();
        const recordKey = { providerId, accountSubjectId: 'shared-login', subjectKind: 'account', quotaScope: 'account' } as const;
        const snapshot = ProviderAccountUsageSnapshotV1Schema.parse({
            v: 1, recordId: buildProviderAccountUsageRecordId(recordKey), recordKey, providerId,
            accountSubject: { kind: 'providerSubject', id: 'shared-login' },
            observedAtMs: Date.now(), fetchedAtMs: Date.now(), staleAfterMs: 60_000,
            source: 'providerHttp', confidence: 'confirmed', state: 'loaded_data',
            meters: [{ meterId: 'weekly', label: 'Weekly', used: 80, limit: 100, unit: 'count',
                utilizationPct: null, remainingPct: null, resetsAt: null, status: 'ok',
                details: { limitCategory: 'usage_limit' } }],
        });
        const publish = (used: number) => writeProviderAccountUsageSnapshotToCache({
            credentialScope: resolveAuthCredentialsScopeKey(credentials),
            snapshot: { ...snapshot, fetchedAtMs: snapshot.fetchedAtMs + 1,
                meters: snapshot.meters.map(meter => ({ ...meter, used })) },
        });
        publish(80);
        storage.setState({ isDataReady: true, sessions: { known: createSessionFixture({
            id: 'known', metadata: { flavor: providerId, path: '/repo', host: 'test',
                providerAccountUsageRefsV1: { v: 1, recordIds: [snapshot.recordId], updatedAtMs: Date.now() } },
        }) }, settings: { ...previous.settings, sessionProviderUsageGaugeMode: 'auto' } });
        try {
            const hook = await renderHook(() => ({
                hud: useProviderUsageGauges({ agentIds: [providerId], accountProfileConnectedServicesV2: [],
                    windowMode: 'most_constrained', fetchEnabled: false }),
                composer: useProviderUsageGauge({ providerId, profileRef: null, modelId: null }),
            }));
            try {
                const values = () => [hook.getCurrent().hud.gauges.get(providerId)?.remainingPct,
                    hook.getCurrent().composer.gauge?.remainingPct];
                expect(values()).toEqual([20, 20]);
                await act(async () => { publish(35); });
                expect(values()).toEqual([65, 65]);
                await act(async () => { publish(100); });
                expect(values()).toEqual([0, 0]);
                // Revalidation is not evidence that this account's known figures disappeared.
                await act(async () => { storage.setState({ isDataReady: false }); });
                expect(values()).toEqual([0, 0]);
            } finally { await hook.unmount(); }
        } finally { storage.setState(previous); }
    });

    it('shows last-used provider usage before takeover, preserves explicit refs, and follows the selected provider', async () => {
        const previous = storage.getState();
        const recordKey = { providerId: 'codex', accountSubjectId: 'native-login', subjectKind: 'account', quotaScope: 'account' } as const;
        const snapshot = ProviderAccountUsageSnapshotV1Schema.parse({
            v: 1, recordId: buildProviderAccountUsageRecordId(recordKey), recordKey, providerId: 'codex',
            accountSubject: { kind: 'providerSubject', id: 'native-login' },
            observedAtMs: Date.now(), fetchedAtMs: Date.now(), staleAfterMs: 60_000,
            source: 'providerHttp', confidence: 'confirmed', state: 'loaded_data',
            accountLabel: 'Native Codex', meters: [{ meterId: 'weekly', label: 'Weekly',
                used: 100, limit: 100, unit: 'count', utilizationPct: null, remainingPct: null,
                resetsAt: null, status: 'ok', details: { limitCategory: 'usage_limit' } }],
        });
        writeProviderAccountUsageSnapshotToCache({ credentialScope: resolveAuthCredentialsScopeKey(credentials), snapshot });
        const explicitKey = { ...recordKey, accountSubjectId: 'explicit-login' };
        const explicitSnapshot = ProviderAccountUsageSnapshotV1Schema.parse({
            ...snapshot, recordKey: explicitKey, recordId: buildProviderAccountUsageRecordId(explicitKey),
            accountSubject: { kind: 'providerSubject', id: explicitKey.accountSubjectId }, accountLabel: 'Explicit login',
            meters: snapshot.meters.map(meter => ({ ...meter, used: 25 })),
        });
        writeProviderAccountUsageSnapshotToCache({ credentialScope: resolveAuthCredentialsScopeKey(credentials), snapshot: explicitSnapshot });
        storage.setState({ isDataReady: true, sessions: {
            direct: createSessionFixture({ id: 'direct', updatedAt: 2_000, metadata: { flavor: 'codex', path: '/repo', host: 'test' } }),
            earlier: createSessionFixture({ id: 'earlier', updatedAt: 1_000, metadata: { flavor: 'codex', path: '/repo', host: 'test',
                providerAccountUsageRefsV1: { v: 1, recordIds: [snapshot.recordId], updatedAtMs: 1_000 } } }),
        }, settings: { ...previous.settings, sessionProviderUsageGaugeMode: 'auto' } });
        try {
            let renderCount = 0;
            const hook = await renderHook((providerId: string) => {
                renderCount++;
                return useProviderUsageGauge({ providerId, profileRef: null, modelId: null });
            },
                { initialProps: 'codex' });
            try {
                expect(hook.getCurrent().gauge?.ringValueLabel).toBe('0');
                expect(hook.getCurrent().gauge?.activeAccountDisplayLabel).toBe('Native Codex');
                const header = await renderHook(() => useProviderUsageGauges({
                    agentIds: ['codex'], accountProfileConnectedServicesV2: [],
                    windowMode: 'most_constrained', fetchEnabled: false,
                }));
                try {
                    expect(header.getCurrent().gauges.get('codex')?.ringValueLabel).toBe('0');
                    expect(header.getCurrent().gauges.get('codex')?.activeAccountDisplayLabel).toBe('Native Codex');
                } finally { await header.unmount(); }
                const settledCount = renderCount;
                await act(async () => storage.setState(state => ({ sessions: { ...state.sessions,
                    other: createSessionFixture({ id: 'other', metadata: { flavor: 'claude', path: '/repo', host: 'test',
                        providerAccountUsageRefsV1: { v: 1, recordIds: [snapshot.recordId], updatedAtMs: 3_000 } } }),
                } })));
                expect(renderCount).toBe(settledCount);
                await hook.rerender('claude');
                expect(hook.getCurrent().gauge).toBeNull();
                await hook.rerender('codex');
                expect(hook.getCurrent().gauge?.ringValueLabel).toBe('0');
                const explicit = await renderHook(() => useProviderUsageGauge({ providerId: 'codex', profileRef: null,
                    modelId: null, metadataRecordIds: [explicitSnapshot.recordId] }));
                try {
                    expect(explicit.getCurrent().gauge?.ringValueLabel).toBe('75');
                    expect(explicit.getCurrent().gauge?.activeAccountDisplayLabel).toBe('Explicit login');
                } finally { await explicit.unmount(); }
                await act(async () => storage.setState({ sessions: {} }));
                expect(hook.getCurrent().gauge).toBeNull();
            } finally { await hook.unmount(); }
        } finally { storage.setState(previous); }
    });
});
