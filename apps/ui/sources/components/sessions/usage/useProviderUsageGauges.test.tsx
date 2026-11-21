import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { AccountProfileSchema, type SessionRuntimeIssueV1 } from '@happier-dev/protocol';
import { createSessionFixture, renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { useProviderUsageGauge } from '@/hooks/server/connectedServices/useProviderUsageGauge';
import { useProviderUsageGauges } from './useProviderUsageGauges';

// Display configuration is independent of sign-in/network activity in this test.
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ credentials: null }) }));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => true }));

afterEach(() => standardCleanup());

function services(status: 'connected' | 'refreshing' | 'needs_reauth' | 'refresh_failed_retryable', serviceId = 'openai-codex') {
    return AccountProfileSchema.parse({ id: 'account', connectedServicesV2: [{
        serviceId, profiles: [{ profileId: 'work', status }],
    }] }).connectedServicesV2;
}

describe('provider usage configuration visibility', () => {
    it.each([
        { agentId: 'codex' as const, serviceId: 'openai-codex' },
        { agentId: 'claude' as const, serviceId: 'anthropic' },
    ] as const)('uses the same latest $agentId limit observation in the HUD and an older open session composer', async ({ agentId, serviceId }) => {
        const previous = storage.getState();
        const nowMs = Date.now();
        const makeIssue = (occurredAt: number, remainingPct: number): SessionRuntimeIssueV1 => ({
            v: 1, scope: 'primary_session', status: 'failed', code: 'usage_limit', source: 'usage_limit',
            provider: agentId, occurredAt,
            usageLimit: { v: 1, resetAtMs: nowMs + 3_600_000, retryAfterMs: null,
                quotaScope: 'account', recoverability: 'wait',
                quotaSnapshotRef: { serviceId, profileId: 'work', fetchedAtMs: occurredAt },
                allWindows: [{ meterId: 'five_hour', scope: 'session', remainingPct, status: 'ok' }] },
        });
        const sessionIssue = makeIssue(nowMs - 60_000, 0);
        const latestIssue = makeIssue(nowMs, 30);
        const otherAccountIssue: SessionRuntimeIssueV1 = { ...makeIssue(nowMs + 1, 0), usageLimit: {
            ...latestIssue.usageLimit!, quotaSnapshotRef: { serviceId, profileId: 'other-login', fetchedAtMs: nowMs + 1 },
        } };
        storage.setState({ isDataReady: true, sessions: {
            open: createSessionFixture({ id: 'open', updatedAt: nowMs, metadata: { flavor: agentId, path: '/repo', host: 'test' }, lastRuntimeIssue: sessionIssue }),
            latest: createSessionFixture({ id: 'latest', updatedAt: nowMs + 1, metadata: { flavor: agentId, path: '/repo', host: 'test' }, lastRuntimeIssue: latestIssue }),
            other: createSessionFixture({ id: 'other', updatedAt: nowMs + 2, metadata: { flavor: agentId, path: '/repo', host: 'test' }, lastRuntimeIssue: otherAccountIssue }),
        } });
        try {
            const hook = await renderHook(() => ({
                header: useProviderUsageGauges({ agentIds: [agentId], accountProfileConnectedServicesV2: services('connected', serviceId),
                    windowMode: 'most_constrained', fetchEnabled: false }),
                composer: useProviderUsageGauge({ providerId: agentId, modelId: null,
                    profileRef: { serviceId, profileId: 'work', provenance: 'connected_binding_profile' },
                    }),
            }));
            try {
                expect(hook.getCurrent().header.gauges.get(agentId)?.remainingPct).toBe(30);
                expect(hook.getCurrent().composer.gauge?.remainingPct).toBe(30);
            } finally { await hook.unmount(); }
        } finally { storage.setState(previous); }
    });

    it('updates composer and header center numbers from the same setting without changing their rings', async () => {
        const previous = storage.getState();
        const issue: SessionRuntimeIssueV1 = {
            v: 1, scope: 'primary_session', status: 'failed', code: 'usage_limit', source: 'usage_limit',
            provider: 'codex', occurredAt: Date.now(),
            usageLimit: { v: 1, resetAtMs: Date.now() + 3_600_000, retryAfterMs: null,
                quotaScope: 'account', recoverability: 'wait',
                quotaSnapshotRef: { serviceId: 'openai-codex', profileId: 'work', fetchedAtMs: Date.now() },
                allWindows: [
                    { meterId: 'five_hour', scope: 'session', remainingPct: 0, status: 'ok' },
                    { meterId: 'weekly', scope: 'weekly', remainingPct: 70, status: 'ok' },
                ] },
        };
        storage.setState({ isDataReady: true, sessions: { limited: createSessionFixture({
            id: 'limited', metadata: { flavor: 'codex', path: '/repo', host: 'test' }, lastRuntimeIssue: issue,
        }) }, settings: { ...previous.settings, sessionProviderUsageGaugeWindowModes: ['session', 'weekly'],
            sessionProviderUsageGaugeNumberWindowMode: 'session' } });
        try {
            const hook = await renderHook(() => ({
                header: useProviderUsageGauges({ agentIds: ['codex'], accountProfileConnectedServicesV2: services('connected'),
                    windowMode: 'most_constrained', fetchEnabled: false }),
                composer: useProviderUsageGauge({ providerId: 'codex', modelId: null,
                    profileRef: { serviceId: 'openai-codex', profileId: 'work', provenance: 'connected_binding_profile' },
                    }),
            }));
            try {
                const rings = hook.getCurrent().composer.gauge?.usageRings;
                expect(rings).toHaveLength(2);
                expect(hook.getCurrent().composer.gauge?.ringValueLabel).toBe('0');
                expect(hook.getCurrent().header.gauges.get('codex')?.ringValueLabel).toBe('0');
                await act(async () => storage.setState(state => ({ settings: {
                    ...state.settings, sessionProviderUsageGaugeNumberWindowMode: 'weekly',
                } })));
                expect(hook.getCurrent().composer.gauge?.ringValueLabel).toBe('70');
                expect(hook.getCurrent().header.gauges.get('codex')?.ringValueLabel).toBe('70');
                expect(hook.getCurrent().composer.gauge?.usageRings).toEqual(rings);
            } finally { await hook.unmount(); }
        } finally { storage.setState(previous); }
    });

    it.each([undefined, 'needs_reauth'] as const)('keeps header and composer at zero without selected window names or fetched quota (health: %s)', async (credentialHealthStatus) => {
        const previous = storage.getState();
        const issue: SessionRuntimeIssueV1 = {
            v: 1, scope: 'primary_session', status: 'failed', code: 'usage_limit', source: 'usage_limit',
            provider: 'codex', occurredAt: Date.now(),
            usageLimit: { v: 1, resetAtMs: Date.now() + 3_600_000, retryAfterMs: null,
                quotaScope: 'account', recoverability: 'wait',
                quotaSnapshotRef: { serviceId: 'openai-codex', profileId: 'work', fetchedAtMs: Date.now() } },
        };
        const session = createSessionFixture({ id: 'limited', metadata: { flavor: 'codex', path: '/repo', host: 'test' }, lastRuntimeIssue: issue });
        storage.setState({ isDataReady: true, sessions: { limited: session }, settings: {
            ...previous.settings, sessionProviderUsageGaugeWindowModes: ['session', 'weekly'],
        } });
        try {
            const hook = await renderHook(() => ({
                header: useProviderUsageGauges({ agentIds: ['codex'], accountProfileConnectedServicesV2: services('connected'),
                    windowMode: 'most_constrained', fetchEnabled: false }),
                composer: useProviderUsageGauge({ providerId: 'codex', modelId: null,
                    profileRef: { serviceId: 'openai-codex', profileId: 'work', provenance: 'connected_binding_profile', credentialHealthStatus },
                    }),
            }));
            try {
                expect(hook.getCurrent().header.gauges.get('codex')?.remainingPct).toBe(0);
                expect(hook.getCurrent().composer.gauge?.remainingPct).toBe(0);
                expect(hook.getCurrent().composer.gauge?.tone).toBe('critical');
                await act(async () => storage.setState({ sessions: { limited: { ...session, lastRuntimeIssue: {
                    ...issue, usageLimit: { ...issue.usageLimit!, quotaSnapshotRef: {
                        serviceId: 'openai-codex', profileId: 'another-login', fetchedAtMs: Date.now(),
                    } },
                } } } }));
                // The provider-wide header must not borrow a different connected login's limit.
                expect(hook.getCurrent().header.gauges.has('codex')).toBe(false);
                expect(hook.getCurrent().header.configuredAgentIds.has('codex')).toBe(true);
            } finally { await hook.unmount(); }
        } finally { storage.setState(previous); }
    });

    it('keeps a configured provider present through credential health changes, and removes it only when unconfigured', async () => {
        const hook = await renderHook((connectedServices: ReturnType<typeof services>) => useProviderUsageGauges({
            agentIds: ['codex'], accountProfileConnectedServicesV2: connectedServices,
            windowMode: 'most_constrained', fetchEnabled: false,
        }), { initialProps: services('connected') });
        try {
            for (const status of ['connected', 'refreshing', 'needs_reauth', 'refresh_failed_retryable'] as const) {
                await hook.rerender(services(status));
                expect(hook.getCurrent().configuredAgentIds.has('codex'), status).toBe(true);
            }
            await hook.rerender([]);
            expect(hook.getCurrent().configuredAgentIds.has('codex')).toBe(false);
        } finally { await hook.unmount(); }
    });

    it('lists every account of a provider separately, numbered in order, and lends none to other providers', async () => {
        const previous = storage.getState();
        const nowMs = Date.now();
        const issueFor = (profileId: string, remainingPct: number): SessionRuntimeIssueV1 => ({
            v: 1, scope: 'primary_session', status: 'failed', code: 'usage_limit', source: 'usage_limit',
            provider: 'claude', occurredAt: nowMs,
            usageLimit: { v: 1, resetAtMs: nowMs + 3_600_000, retryAfterMs: null, quotaScope: 'account', recoverability: 'wait',
                quotaSnapshotRef: { serviceId: 'claude-subscription', profileId, fetchedAtMs: nowMs },
                allWindows: [{ meterId: 'five_hour', scope: 'session', remainingPct, status: 'ok' }] },
        });
        storage.setState({ isDataReady: true, sessions: {
            one: createSessionFixture({ id: 'one', metadata: { flavor: 'claude', path: '/repo', host: 'test' }, lastRuntimeIssue: issueFor('Claude-1', 40) }),
            two: createSessionFixture({ id: 'two', metadata: { flavor: 'claude', path: '/repo', host: 'test' }, lastRuntimeIssue: issueFor('Claude-2', 0) }),
        } });
        const connectedServices = AccountProfileSchema.parse({ id: 'account', connectedServicesV2: [{
            serviceId: 'claude-subscription',
            profiles: [{ profileId: 'Claude-1', status: 'connected' }, { profileId: 'Claude-2', status: 'connected' }],
        }] }).connectedServicesV2;
        try {
            const hook = await renderHook(() => useProviderUsageGauges({
                agentIds: ['claude', 'opencode', 'pi'], accountProfileConnectedServicesV2: connectedServices,
                windowMode: 'most_constrained', fetchEnabled: false,
            }));
            try {
                const accounts = hook.getCurrent().accounts;
                expect(accounts.map((account) => [account.agentId, account.profileRef?.profileId ?? null])).toEqual([
                    ['claude', 'Claude-1'],
                    ['claude', 'Claude-2'],
                ]);
                expect(accounts.map((account) => account.gauge?.providerDisplayName)).toEqual(['Claude 1', 'Claude 2']);
                expect(accounts.map((account) => account.gauge?.remainingPct)).toEqual([40, 0]);
                expect(hook.getCurrent().configuredAgentIds.has('opencode')).toBe(false);
                expect(hook.getCurrent().configuredAgentIds.has('pi')).toBe(false);
            } finally { await hook.unmount(); }
        } finally { storage.setState(previous); }
    });
});
