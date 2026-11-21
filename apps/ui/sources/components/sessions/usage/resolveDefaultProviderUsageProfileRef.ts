import type { AccountProfile } from '@happier-dev/protocol';
import { isConnectedServiceCredentialHealthStatusUsable } from '@happier-dev/protocol';

import { getAgentCore, isAgentId } from '@/agents/catalog/catalog';
import { resolveConnectedServiceCredentialHealthStatus } from '@/sync/domains/connectedServices/resolveConnectedServiceCredentialHealthStatus';

type AccountProfileConnectedService = AccountProfile['connectedServicesV2'][number];

/** The connected services whose quota is this provider's own usage (never another provider's login). */
export function resolveProviderUsageServiceIds(agentId: string | null): readonly string[] {
    if (!agentId || !isAgentId(agentId)) return [];
    return getAgentCore(agentId).connectedServices?.usageServiceIds ?? [];
}

/** Selects the same default connected login for the HUD, picker and composer. */
export function resolveDefaultProviderUsageProfileRef(params: Readonly<{
    agentId: string | null;
    connectedServices: ReadonlyArray<AccountProfileConnectedService>;
}>): Readonly<{ serviceId: string; profileId: string }> | null {
    for (const serviceId of resolveProviderUsageServiceIds(params.agentId)) {
        const service = params.connectedServices.find((candidate) => candidate.serviceId === serviceId);
        const profile = service?.profiles.find((candidate) => (
            candidate.profileId.trim().length > 0
            && isConnectedServiceCredentialHealthStatusUsable(resolveConnectedServiceCredentialHealthStatus(candidate.status))
        ));
        if (profile) return { serviceId, profileId: profile.profileId.trim() };
    }
    return null;
}
