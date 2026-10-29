import * as React from 'react';
import type { AccountProfile } from '@happier-dev/protocol';
import { isConnectedServiceCredentialHealthStatusUsable } from '@happier-dev/protocol';

import { getAgentCore, isAgentId } from '@/agents/catalog/catalog';
import type { ResolvedBackendCatalogEntry } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';
import { connectedServiceQuotaGaugeFormatter } from '@/components/sessions/usage/connectedServiceQuotaGaugeFormatter';
import { useConnectedServiceQuotaSnapshots } from '@/hooks/server/connectedServices/useConnectedServiceQuotaSnapshots';
import {
    computeConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeWindowMode,
} from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { connectedServiceProfileKey } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { resolveConnectedServiceCredentialHealthStatus } from '@/sync/domains/connectedServices/resolveConnectedServiceCredentialHealthStatus';
import { nowServerMs } from '@/sync/runtime/time';

type AccountProfileConnectedService = AccountProfile['connectedServicesV2'][number];

/**
 * The usage ring one Agent row of the picker rail shows, keyed by catalog target key.
 * Only Agents with a usable connected-service profile have a gauge; every other row
 * (not installed, not configured, or simply without a usage source) has no entry and
 * renders as a grey open ring.
 */
export function useAgentPickerUsageGauges(params: Readonly<{
    entries: readonly ResolvedBackendCatalogEntry[];
    accountProfileConnectedServicesV2: ReadonlyArray<AccountProfileConnectedService>;
    windowMode: ConnectedServiceQuotaGaugeWindowMode;
    /** Quota is only fetched once the picker has been approached; until then cached values render. */
    demanded: boolean;
}>): ReadonlyMap<string, ConnectedServiceQuotaGaugeViewModel> {
    const profileRefByTargetKey = React.useMemo(() => {
        const refs = new Map<string, { serviceId: string; profileId: string }>();
        for (const entry of params.entries) {
            if (entry.builtInAgentId === null || !isAgentId(entry.builtInAgentId)) continue;
            const supportedServiceIds = getAgentCore(entry.builtInAgentId).connectedServices?.supportedServiceIds ?? [];
            for (const serviceId of supportedServiceIds) {
                const service = params.accountProfileConnectedServicesV2.find((candidate) => candidate.serviceId === serviceId);
                const profile = service?.profiles.find((candidate) => (
                    candidate.profileId.trim().length > 0
                    && isConnectedServiceCredentialHealthStatusUsable(resolveConnectedServiceCredentialHealthStatus(candidate.status))
                ));
                if (!profile) continue;
                refs.set(entry.targetKey, { serviceId, profileId: profile.profileId.trim() });
                break;
            }
        }
        return refs;
    }, [params.accountProfileConnectedServicesV2, params.entries]);

    const profileRefs = React.useMemo(() => [...profileRefByTargetKey.values()], [profileRefByTargetKey]);
    const snapshots = useConnectedServiceQuotaSnapshots(profileRefs, { fetchPolicy: params.demanded ? 'poll' : 'cache_only' });

    return React.useMemo(() => {
        const gauges = new Map<string, ConnectedServiceQuotaGaugeViewModel>();
        const nowMs = nowServerMs();
        for (const [targetKey, ref] of profileRefByTargetKey) {
            const snapshot = snapshots.snapshotsByKey[connectedServiceProfileKey(ref)] ?? null;
            if (!snapshot) continue;
            const gauge = computeConnectedServiceQuotaGaugeViewModel({
                snapshot,
                windowMode: params.windowMode,
                nowMs,
                formatter: connectedServiceQuotaGaugeFormatter,
            });
            if (gauge) gauges.set(targetKey, gauge);
        }
        return gauges;
    }, [params.windowMode, profileRefByTargetKey, snapshots.snapshotsByKey]);
}
