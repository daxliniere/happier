import { describe, expect, it } from 'vitest';
import { AccountProfileSchema } from '@happier-dev/protocol';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import { resolveDefaultProviderUsageProfileRef } from './resolveDefaultProviderUsageProfileRef';

describe('resolveDefaultProviderUsageProfileRef', () => {
    it.each(['claude', 'codex'] as const)('selects the first usable configured login for %s', (agentId: AgentId) => {
        const serviceId = getAgentCore(agentId).connectedServices?.supportedServiceIds[0];
        expect(serviceId).toBeDefined();
        const connectedServices = AccountProfileSchema.parse({
            id: 'account',
            connectedServicesV2: [{
                serviceId,
                profiles: [
                    { profileId: 'expired', status: 'needs_reauth' },
                    { profileId: 'current', status: 'connected' },
                ],
            }],
        }).connectedServicesV2;

        expect(resolveDefaultProviderUsageProfileRef({ agentId, connectedServices })).toEqual({
            serviceId,
            profileId: 'current',
        });
    });

    it('returns no profile for an unsupported or unconfigured provider', () => {
        const connectedServices = AccountProfileSchema.parse({ id: 'account', connectedServicesV2: [] }).connectedServicesV2;
        expect(resolveDefaultProviderUsageProfileRef({ agentId: 'opencode', connectedServices })).toBeNull();
        expect(resolveDefaultProviderUsageProfileRef({ agentId: null, connectedServices })).toBeNull();
    });
});
