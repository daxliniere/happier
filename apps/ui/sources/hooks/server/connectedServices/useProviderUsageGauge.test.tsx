import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { buildProviderAccountUsageRecordId, ProviderAccountUsageSnapshotV1Schema } from '@happier-dev/protocol';
import { createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { resolveAuthCredentialsScopeKey } from '@/auth/storage/resolveAuthCredentialsScopeKey';
import { writeProviderAccountUsageSnapshotToCache, __resetProviderAccountUsageSnapshotCache } from '@/sync/domains/connectedServices/accountUsage/cache';
import { useProviderUsageGauge } from './useProviderUsageGauge';

const credentials = { token: 'test', secret: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url') };
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ credentials }) }));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => true }));

afterEach(() => { standardCleanup(); __resetProviderAccountUsageSnapshotCache(); });

describe('useProviderUsageGauge native usage discovery', () => {
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
