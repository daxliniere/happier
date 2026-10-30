import * as React from 'react';
import type { AccountProfile } from '@happier-dev/protocol';
import {
    isConnectedServiceCredentialHealthStatusUsable,
    readProviderAccountUsageRecordIdsFromMetadata,
} from '@happier-dev/protocol';

import { getAgentCore, isAgentId, resolveAgentIdFromFlavor, type AgentId } from '@/agents/catalog/catalog';
import { connectedServiceQuotaGaugeFormatter } from '@/components/sessions/usage/connectedServiceQuotaGaugeFormatter';
import { useConnectedServiceQuotaSnapshots } from '@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshots';
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
}>): ReadonlyMap<AgentId, ConnectedServiceQuotaGaugeViewModel> {
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
        const byAgentId = new Map<AgentId, string[]>();
        for (const session of sessions) {
            const agentId = resolveAgentIdFromFlavor(session.metadata?.flavor);
            if (!agentId || !isAgentId(agentId) || !wanted.has(agentId) || byAgentId.has(agentId)) continue;
            const recordIds = readProviderAccountUsageRecordIdsFromMetadata(session.metadata);
            if (recordIds.length > 0) byAgentId.set(agentId, recordIds);
        }
        return byAgentId;
    }, [params.agentIds, sessions]);
    const allRecordIds = React.useMemo(
        () => params.fetchEnabled ? [...recordIdsByAgentId.values()].flat() : [],
        [params.fetchEnabled, recordIdsByAgentId],
    );
    const accountUsageSnapshots = useProviderAccountUsageSnapshots(allRecordIds);

    return React.useMemo(() => {
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
                nowMs,
                formatter: connectedServiceQuotaGaugeFormatter,
            });
            if (gauge) gauges.set(agentId, gauge);
        }
        return gauges;
    }, [accountUsageSnapshots, params.agentIds, params.windowMode, profileRefByAgentId, quotaSnapshots.snapshotsByKey, recordIdsByAgentId]);
}
