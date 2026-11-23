import * as React from 'react';

import type { SessionRuntimeIssueV1 } from '@happier-dev/protocol';

import { resolveConnectedServiceQuotaProfileRefForSession } from '@/components/sessions/shell/resolveConnectedServiceQuotaProfileRefForSession';
import { useProviderUsageGauge } from '@/hooks/server/connectedServices/useProviderUsageGauge';
import type { Metadata } from '@/sync/domains/state/storageTypes';
import { useProfile } from '@/sync/store/hooks';

import { selectedAccountClearsUsageLimit } from './selectedAccountClearsUsageLimit';

/**
 * Whether the session's stored usage limit was hit by a different account than the one the session
 * is now set to, and that selected account is shown to have capacity.
 *
 * The selected account comes from the session's own bindings, not from the limit issue: the issue
 * names whoever hit the limit, which is exactly the account this answer compares against. The
 * selected account's figures are only read when the two differ, so a session on the account that hit
 * its limit adds no second lookup.
 */
export function useSelectedAccountClearsUsageLimit(params: Readonly<{
    metadata: Metadata | null | undefined;
    agentId: string | null;
    issue: SessionRuntimeIssueV1 | null | undefined;
}>): boolean {
    const accountProfile = useProfile();
    const limitSource = params.issue?.usageLimit?.connectedService ?? null;
    const selectedRef = React.useMemo(() => (
        params.agentId
            ? resolveConnectedServiceQuotaProfileRefForSession({
                metadata: params.metadata,
                agentId: params.agentId,
                accountProfileConnectedServicesV2: accountProfile?.connectedServicesV2 ?? [],
                runtimeIssue: null,
            })
            : null
    ), [accountProfile?.connectedServicesV2, params.agentId, params.metadata]);
    const selected = selectedRef && !selectedRef.groupId && selectedRef.provenance === 'connected_binding_profile'
        ? { serviceId: selectedRef.serviceId, profileId: selectedRef.profileId }
        : null;
    const differsFromLimitedAccount = Boolean(
        selected
        && limitSource
        && !limitSource.groupId
        && limitSource.profileId
        && limitSource.serviceId === selected.serviceId
        && limitSource.profileId !== selected.profileId,
    );

    const { gauge } = useProviderUsageGauge({
        providerId: params.agentId,
        profileRef: differsFromLimitedAccount ? selectedRef : null,
        modelId: null,
    });

    return React.useMemo(() => selectedAccountClearsUsageLimit({
        issue: params.issue,
        selected,
        usage: gauge
            ? {
                profileId: gauge.sourceProfileId,
                isStale: gauge.isStale,
                rows: gauge.allMeterRows,
            }
            : null,
    }), [gauge, params.issue, selected?.profileId, selected?.serviceId]);
}
