import type { ConnectedServiceBindingsV1 } from '@happier-dev/protocol';

import type { AgentId } from '@/agents/catalog/catalog';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

import type { ProviderUsageAccount } from './useProviderUsageGauges';

/**
 * The usage figure the composer ring shows for an Agent the owner has armed but not yet continued with.
 *
 * Without a chosen account the ring keeps its Agent-level figure (`fallback`). Once the owner picks a
 * specific account, the ring must describe THAT account: showing another account's quota under the
 * chosen account's name is worse than showing nothing, so a chosen account with no figure yet yields
 * null rather than falling back. A pool (group) choice has no single account to name, so it keeps the
 * Agent-level figure.
 */
export function selectArmedAgentUsageGauge(params: Readonly<{
    accounts: readonly ProviderUsageAccount[];
    agentId: AgentId;
    connectedServices: ConnectedServiceBindingsV1 | null | undefined;
    fallback: ConnectedServiceQuotaGaugeViewModel | null;
}>): ConnectedServiceQuotaGaugeViewModel | null {
    const bindings = Object.entries(params.connectedServices?.bindingsByServiceId ?? {});
    if (bindings.length === 0) return params.fallback;

    const agentAccounts = params.accounts.filter((account) => account.agentId === params.agentId);
    for (const [serviceId, binding] of bindings) {
        if (binding.source !== 'connected') continue;
        if (binding.selection === 'group') return params.fallback;
        const chosen = agentAccounts.find((account) => (
            account.profileRef?.serviceId === serviceId && account.profileRef.profileId === binding.profileId
        ));
        return chosen?.gauge ?? null;
    }
    // Every service was explicitly set to native auth: the native login is the chosen account.
    return agentAccounts.find((account) => account.profileRef === null)?.gauge ?? null;
}
