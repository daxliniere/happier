import { resolveAgentIdFromSessionMetadata, type AgentId } from '@happier-dev/agents';
import { readProviderAccountUsageRecordIdsFromMetadata } from '@happier-dev/protocol';

export type ProviderUsageRefreshTarget = Readonly<{
    connectedProfileRef: Readonly<{ serviceId: string; profileId: string }> | null;
    recordIds: readonly string[];
}>;

/** Shared native account selection for displayed gauges and refresh requests. */
export function selectLatestProviderUsageRecordIdsByAgent(sessions: ReadonlyArray<Readonly<{ metadata: unknown }>>) {
    const records = new Map<AgentId, string[]>();
    for (const session of sessions) {
        const providerId = resolveAgentIdFromSessionMetadata(session.metadata);
        if (!providerId || records.has(providerId)) continue;
        const recordIds = readProviderAccountUsageRecordIdsFromMetadata(session.metadata);
        if (recordIds.length > 0) records.set(providerId, recordIds);
    }
    return records;
}

/** Connected profiles and the latest native usage source per provider, matching the displayed accounts. */
export function collectConfiguredProviderUsageRefreshTargets(params: Readonly<{
    connectedServices: ReadonlyArray<Readonly<{ serviceId: string; profiles: ReadonlyArray<Readonly<{ profileId: string }>> }>>;
    /** Newest sessions first, as returned by useAllSessions. */
    sessions: ReadonlyArray<Readonly<{ metadata: unknown }>>;
}>): readonly ProviderUsageRefreshTarget[] {
    const targets: ProviderUsageRefreshTarget[] = [];
    for (const service of params.connectedServices) {
        for (const profile of service.profiles) {
            const profileId = profile.profileId.trim();
            if (profileId) targets.push({ connectedProfileRef: { serviceId: service.serviceId, profileId }, recordIds: [] });
        }
    }
    for (const recordIds of selectLatestProviderUsageRecordIdsByAgent(params.sessions).values()) {
        targets.push({ connectedProfileRef: null, recordIds });
    }
    return targets;
}
