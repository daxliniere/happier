import * as React from 'react';

import type { AgentId } from '@/agents/catalog/catalog';
import { useProfile, useSetting } from '@/sync/domains/state/storage';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

import { resolveProviderUsageGaugeWindowMode } from './resolveProviderUsageGaugeWindowMode';
import { useProviderUsageGauges } from './useProviderUsageGauges';

/** The composer usage gauge for one Agent before any session exists (New Session). */
export function useAgentProviderUsageGauge(agentId: AgentId | null | undefined): Readonly<{
    gauge: ConnectedServiceQuotaGaugeViewModel | null;
    refresh: () => void;
}> {
    const accountProfile = useProfile();
    const windowMode = resolveProviderUsageGaugeWindowMode(useSetting('sessionProviderUsageGaugeWindowMode'));
    const agentIds = React.useMemo(() => (agentId ? [agentId] : []), [agentId]);
    const { gauges, refreshAgent } = useProviderUsageGauges({
        agentIds,
        accountProfileConnectedServicesV2: accountProfile?.connectedServicesV2 ?? [],
        windowMode,
        fetchEnabled: true,
    });
    const gauge = agentId ? gauges.get(agentId) ?? null : null;
    const refresh = React.useCallback(() => {
        if (agentId) refreshAgent(agentId);
    }, [agentId, refreshAgent]);
    return { gauge, refresh };
}
