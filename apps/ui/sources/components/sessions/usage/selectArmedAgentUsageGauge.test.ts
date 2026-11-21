import { describe, expect, it } from 'vitest';

import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

import { selectArmedAgentUsageGauge } from './selectArmedAgentUsageGauge';
import type { ProviderUsageAccount } from './useProviderUsageGauges';

const gauge = (label: string) => ({ label }) as unknown as ConnectedServiceQuotaGaugeViewModel;
const FALLBACK = gauge('agent-level');

function account(profileId: string | null, label: string | null): ProviderUsageAccount {
    return {
        key: `claude:${profileId ?? 'native'}`,
        agentId: 'claude',
        profileRef: profileId === null ? null : { serviceId: 'claude-subscription', profileId },
        accountNumber: 1,
        accountCount: 2,
        label: 'Claude',
        gauge: label === null ? null : gauge(label),
    };
}

const accounts = [account('claude2', 'claude2-gauge'), account('claude1', 'claude1-gauge'), account(null, 'native-gauge')];

const choose = (binding: unknown) => ({
    v: 1 as const,
    bindingsByServiceId: { 'claude-subscription': binding },
}) as never;

describe('selectArmedAgentUsageGauge', () => {
    it('keeps the Agent-level figure while no account has been chosen', () => {
        expect(selectArmedAgentUsageGauge({ accounts, agentId: 'claude', connectedServices: null, fallback: FALLBACK })).toBe(FALLBACK);
    });

    it('shows the chosen connected account, not the first account of the Agent', () => {
        const result = selectArmedAgentUsageGauge({
            accounts,
            agentId: 'claude',
            connectedServices: choose({ source: 'connected', selection: 'profile', profileId: 'claude1' }),
            fallback: FALLBACK,
        });
        expect(result).toEqual(gauge('claude1-gauge'));
    });

    it('shows nothing rather than another account while the chosen account has no figure yet', () => {
        const result = selectArmedAgentUsageGauge({
            accounts: [account('claude2', 'claude2-gauge'), account('claude1', null)],
            agentId: 'claude',
            connectedServices: choose({ source: 'connected', selection: 'profile', profileId: 'claude1' }),
            fallback: FALLBACK,
        });
        expect(result).toBeNull();
    });

    it('shows the native login when native auth was chosen explicitly', () => {
        const result = selectArmedAgentUsageGauge({
            accounts,
            agentId: 'claude',
            connectedServices: choose({ source: 'native' }),
            fallback: FALLBACK,
        });
        expect(result).toEqual(gauge('native-gauge'));
    });

    it('keeps the Agent-level figure for a pool choice, which names no single account', () => {
        const result = selectArmedAgentUsageGauge({
            accounts,
            agentId: 'claude',
            connectedServices: choose({ source: 'connected', selection: 'group', groupId: 'team' }),
            fallback: FALLBACK,
        });
        expect(result).toBe(FALLBACK);
    });
});
