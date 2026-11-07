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

function services(status: 'connected' | 'refreshing' | 'needs_reauth' | 'refresh_failed_retryable') {
    return AccountProfileSchema.parse({ id: 'account', connectedServicesV2: [{
        serviceId: 'openai-codex', profiles: [{ profileId: 'work', status }],
    }] }).connectedServicesV2;
}

describe('provider usage configuration visibility', () => {
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
                    runtimeIssue: issue }),
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
});
