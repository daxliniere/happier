import * as React from 'react';
import type { AccountProfile } from '@happier-dev/protocol';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import { connectedServiceQuotaGaugeFormatter } from '@/components/sessions/usage/connectedServiceQuotaGaugeFormatter';
import { useProviderUsageSources } from '@/hooks/server/connectedServices/useProviderUsageSources';
import { runProviderUsageRefresh, useProviderUsageRefreshContext } from '@/hooks/server/connectedServices/useProviderUsageRefresh';
import {
    computeConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeWindowMode,
} from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { nowServerMs } from '@/sync/runtime/time';
import { useSetting } from '@/sync/domains/state/storage';
import { useLatestProviderUsageRecordIdsByAgent, useLatestProviderUsageRuntimeIssuesByAgent } from '@/sync/store/hooks';
import { t } from '@/text';

type AccountProfileConnectedService = AccountProfile['connectedServicesV2'][number];

/**
 * Usage gauge per Agent, for surfaces that show every configured provider at once (the
 * sessions pane header and the Agent picker rail).
 *
 * All observations and account matching are owned by useProviderUsageSources, shared
 * with both composers. This hook only projects gauges and configuration for the rail/HUD.
 */
export function useProviderUsageGauges(params: Readonly<{
    agentIds: readonly AgentId[];
    accountProfileConnectedServicesV2: ReadonlyArray<AccountProfileConnectedService>;
    windowMode: ConnectedServiceQuotaGaugeWindowMode;
    /** Usage is only fetched while a surface wants it; until then only cached values render. */
    fetchEnabled: boolean;
}>): Readonly<{
    gauges: ReadonlyMap<AgentId, ConnectedServiceQuotaGaugeViewModel>;
    /** Configured profiles or native logins remain present even when credential health prevents querying. */
    configuredAgentIds: ReadonlySet<AgentId>;
    /** Queries every configured provider, including this Agent's displayed account. */
    refreshAgent: (agentId: AgentId) => void;
}> {
    const windowModes = useSetting('sessionProviderUsageGaugeWindowModes');
    const numberWindowMode = useSetting('sessionProviderUsageGaugeNumberWindowMode');
    const requests = React.useMemo(() => params.agentIds.map(providerId => ({ providerId })), [params.agentIds]);
    const resolved = useProviderUsageSources({
        requests,
        connectedServices: params.accountProfileConnectedServicesV2,
        fetchEnabled: params.fetchEnabled,
    });
    const latestRecordIdsByAgent = useLatestProviderUsageRecordIdsByAgent();
    const latestRuntimeIssuesByAgent = useLatestProviderUsageRuntimeIssuesByAgent();
    const recordIdsByAgentId = latestRecordIdsByAgent;
    const profileRefByAgentId = React.useMemo(() => new Map(params.agentIds.map((id, index) => (
        [id, resolved[index].profileRef] as const
    ))), [params.agentIds, resolved]);

    const refreshContext = useProviderUsageRefreshContext();
    const refreshAgent = React.useCallback((agentId: AgentId) => {
        if (!refreshContext) return;
        runProviderUsageRefresh(refreshContext, {
            connectedProfileRef: profileRefByAgentId.get(agentId) ?? null,
            recordIds: recordIdsByAgentId.get(agentId) ?? [],
        });
    }, [profileRefByAgentId, recordIdsByAgentId, refreshContext]);

    const gauges = React.useMemo(() => {
        const gauges = new Map<AgentId, ConnectedServiceQuotaGaugeViewModel>();
        const nowMs = nowServerMs();
        for (const [index, agentId] of params.agentIds.entries()) {
            const gaugeSource = resolved[index].gaugeSource;
            if (!gaugeSource) continue;
            const gauge = computeConnectedServiceQuotaGaugeViewModel({
                snapshot: gaugeSource.snapshot,
                windowMode: params.windowMode,
                windowModes,
                numberWindowMode,
                nowMs,
                formatter: connectedServiceQuotaGaugeFormatter,
                providerDisplayName: t(getAgentCore(agentId).displayNameKey),
            });
            if (gauge) gauges.set(agentId, gauge);
        }
        return gauges;
    }, [resolved, params.agentIds, params.windowMode, windowModes, numberWindowMode]);
    const configuredAgentIds = React.useMemo(() => new Set(
        params.agentIds.filter((agentId, index) => (
            // Configuration and query eligibility are different facts. A refresh/reconnect status
            // must not remove a saved provider from the HUD while its figures are unavailable.
            (getAgentCore(agentId).connectedServices?.supportedServiceIds ?? []).some((serviceId) => (
                params.accountProfileConnectedServicesV2.some((service) => service.serviceId === serviceId
                    && service.profiles.some((profile) => profile.profileId.trim().length > 0))
            ))
            || recordIdsByAgentId.has(agentId)
            || latestRuntimeIssuesByAgent.has(agentId)
            || resolved[index].gaugeSource !== null
        )),
    ), [params.agentIds, params.accountProfileConnectedServicesV2, recordIdsByAgentId, latestRuntimeIssuesByAgent, resolved]);
    return React.useMemo(() => ({ gauges, configuredAgentIds, refreshAgent }), [gauges, configuredAgentIds, refreshAgent]);
}
