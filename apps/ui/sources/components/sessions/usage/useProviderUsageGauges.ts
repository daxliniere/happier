import * as React from 'react';
import type { AccountProfile } from '@happier-dev/protocol';
import {
    isConnectedServiceCredentialHealthStatusUsable,
} from '@happier-dev/protocol';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import { selectLatestProviderUsageRecordIdsByAgent } from '@/sync/domains/connectedServices/accountUsage/providerUsageRefreshTargets';
import { connectedServiceQuotaGaugeFormatter } from '@/components/sessions/usage/connectedServiceQuotaGaugeFormatter';
import { useConnectedServiceQuotaSnapshots } from '@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshots';
import { runProviderUsageRefresh, useProviderUsageRefreshContext } from '@/hooks/server/connectedServices/useProviderUsageRefresh';
import { useProviderAccountUsageSnapshots } from '@/hooks/server/connectedServices/useProviderAccountUsageSnapshots';
import { selectProviderUsageDisplaySnapshot } from '@/sync/domains/connectedServices/accountUsage/selectors';
import {
    computeConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeWindowMode,
} from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { connectedServiceProfileKey } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { resolveConnectedServiceCredentialHealthStatus } from '@/sync/domains/connectedServices/resolveConnectedServiceCredentialHealthStatus';
import { nowServerMs } from '@/sync/runtime/time';
import { useSetting } from '@/sync/domains/state/storage';
import { useAllSessions } from '@/sync/store/hooks';

type AccountProfileConnectedService = AccountProfile['connectedServicesV2'][number];

/**
 * Usage gauge per Agent, for surfaces that show every configured provider at once (the
 * sessions pane header and the Agent picker rail).
 *
 * Two sources, through the same selector the composer uses: a usable connected-service
 * profile's quota, else the provider account usage the Agent's most recent session
 * recorded for the native login. An Agent with neither has no entry.
 */
export function useProviderUsageGauges(params: Readonly<{
    agentIds: readonly AgentId[];
    accountProfileConnectedServicesV2: ReadonlyArray<AccountProfileConnectedService>;
    windowMode: ConnectedServiceQuotaGaugeWindowMode;
    /** Usage is only fetched while a surface wants it; until then only cached values render. */
    fetchEnabled: boolean;
}>): Readonly<{
    gauges: ReadonlyMap<AgentId, ConnectedServiceQuotaGaugeViewModel>;
    /** Queries every configured provider, including this Agent's displayed account. */
    refreshAgent: (agentId: AgentId) => void;
}> {
    const windowModes = useSetting('sessionProviderUsageGaugeWindowModes');
    const profileRefByAgentId = React.useMemo(() => {
        const refs = new Map<AgentId, { serviceId: string; profileId: string }>();
        for (const agentId of params.agentIds) {
            const supportedServiceIds = getAgentCore(agentId).connectedServices?.supportedServiceIds ?? [];
            for (const serviceId of supportedServiceIds) {
                const service = params.accountProfileConnectedServicesV2.find((candidate) => candidate.serviceId === serviceId);
                const profile = service?.profiles.find((candidate) => (
                    candidate.profileId.trim().length > 0
                    && isConnectedServiceCredentialHealthStatusUsable(resolveConnectedServiceCredentialHealthStatus(candidate.status))
                ));
                if (!profile) continue;
                refs.set(agentId, { serviceId, profileId: profile.profileId.trim() });
                break;
            }
        }
        return refs;
    }, [params.accountProfileConnectedServicesV2, params.agentIds]);
    const profileRefs = React.useMemo(() => [...profileRefByAgentId.values()], [profileRefByAgentId]);
    const quotaSnapshots = useConnectedServiceQuotaSnapshots(profileRefs, {
        fetchPolicy: params.fetchEnabled ? 'poll' : 'cache_only',
    });

    // The most recent session per Agent that recorded usage refs speaks for that Agent's login.
    const sessions = useAllSessions();
    const recordIdsByAgentId = React.useMemo(() => {
        const wanted = new Set<string>(params.agentIds);
        return new Map([...selectLatestProviderUsageRecordIdsByAgent(sessions)]
            .filter(([agentId]) => wanted.has(agentId)));
    }, [params.agentIds, sessions]);
    const allRecordIds = React.useMemo(
        () => params.fetchEnabled ? [...recordIdsByAgentId.values()].flat() : [],
        [params.fetchEnabled, recordIdsByAgentId],
    );
    const accountUsageSnapshots = useProviderAccountUsageSnapshots(allRecordIds);

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
        for (const agentId of params.agentIds) {
            const ref = profileRefByAgentId.get(agentId) ?? null;
            const source = selectProviderUsageDisplaySnapshot({
                providerId: agentId,
                metadataRecordIds: recordIdsByAgentId.get(agentId) ?? [],
                accountUsageSnapshotsByRecordId: accountUsageSnapshots,
                connectedServiceProfileRef: ref ? { ...ref, provenance: 'published_quota_ref' } : null,
                connectedServiceQuotaView: ref ? quotaSnapshots.snapshotsByKey[connectedServiceProfileKey(ref)] ?? null : null,
            });
            if (!source) continue;
            const gauge = computeConnectedServiceQuotaGaugeViewModel({
                snapshot: source.snapshot,
                windowMode: params.windowMode,
                windowModes,
                nowMs,
                formatter: connectedServiceQuotaGaugeFormatter,
            });
            if (gauge) gauges.set(agentId, gauge);
        }
        return gauges;
    }, [accountUsageSnapshots, params.agentIds, params.windowMode, windowModes, profileRefByAgentId, quotaSnapshots.snapshotsByKey, recordIdsByAgentId]);
    return React.useMemo(() => ({ gauges, refreshAgent }), [gauges, refreshAgent]);
}
