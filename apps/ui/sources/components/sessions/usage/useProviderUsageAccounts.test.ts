import { describe, expect, it } from 'vitest';

import { buildProviderUsageAccountRequests } from './useProviderUsageAccounts';

function service(serviceId: string, profileIds: string[]) {
    return {
        serviceId,
        profiles: profileIds.map((profileId) => ({ profileId, status: 'connected', providerEmail: `${profileId}@example.test` })),
    } as never;
}

describe('buildProviderUsageAccountRequests', () => {
    it('lists connected logins in Settings order, then the native login, per provider', () => {
        const requests = buildProviderUsageAccountRequests({
            agentIds: ['claude', 'codex'],
            connectedServices: [service('anthropic', ['claude-10', 'claude-2']), service('openai-codex', ['work'])],
            nativeRecordIdsByAgent: new Map([['claude', ['paug_v1_nativeaa']]]),
        });
        expect(requests.map((request) => request.key)).toEqual([
            'claude:anthropic/claude-2',
            'claude:anthropic/claude-10',
            'claude:native',
            'codex:openai-codex/work',
        ]);
        expect(requests[0]?.providerEmail).toBe('claude-2@example.test');
        expect(requests[2]?.metadataRecordIds).toEqual(['paug_v1_nativeaa']);
    });

    it('never lists another provider\'s login for an agent that can borrow it', () => {
        const requests = buildProviderUsageAccountRequests({
            agentIds: ['opencode'],
            connectedServices: [service('anthropic', ['claude-1']), service('openai-codex', ['work'])],
            nativeRecordIdsByAgent: new Map(),
        });
        expect(requests).toEqual([{ key: 'opencode:default', agentId: 'opencode', profileRef: null, identified: false }]);
    });
});
