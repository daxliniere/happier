import { describe, expect, it } from 'vitest';

import { resolveProviderUsageAccountIdentity, selectDistinctProviderUsageAccounts } from './providerUsageAccountIdentity';

describe('provider usage account identity', () => {
    it('lists every form under which a snapshot names its login', () => {
        expect(resolveProviderUsageAccountIdentity({ activeAccountId: 'acct-2', accountLabel: 'Claude2@Example.com' }))
            .toEqual(['id:acct-2', 'label:claude2@example.com']);
        expect(resolveProviderUsageAccountIdentity({ accountLabel: ' Claude2@Example.com ' })).toEqual(['label:claude2@example.com']);
        expect(resolveProviderUsageAccountIdentity(null)).toEqual([]);
        expect(resolveProviderUsageAccountIdentity({ accountLabel: null })).toEqual([]);
    });

    it('keeps the first entry of each provider login and drops later duplicates', () => {
        const kept = selectDistinctProviderUsageAccounts([
            { agentId: 'claude', identity: ['label:claude1@example.com'] },
            { agentId: 'claude', identity: ['label:claude2@example.com'] },
            // The native login is the same person as the connected Claude-2 profile.
            { agentId: 'claude', identity: ['label:claude2@example.com'] },
            // Unknown identity is never merged.
            { agentId: 'claude', identity: [] },
            // The same login under another provider is that provider's own entry.
            { agentId: 'codex', identity: ['label:claude2@example.com'] },
        ]);
        expect(kept).toEqual([0, 1, 3, 4]);
    });

    it('matches one login known by id in one entry and only by email in another', () => {
        expect(selectDistinctProviderUsageAccounts([
            { agentId: 'claude', identity: ['label:claude2@example.com'] },
            { agentId: 'claude', identity: ['id:acct-2', 'label:claude2@example.com'] },
            { agentId: 'claude', identity: ['id:acct-2'] },
        ])).toEqual([0]);
    });

    it('merges earlier entries that a later entry shows to be the same login', () => {
        expect(selectDistinctProviderUsageAccounts([
            { agentId: 'claude', identity: ['id:acct-2'] },
            { agentId: 'claude', identity: ['label:claude2@example.com'] },
            { agentId: 'claude', identity: ['id:acct-2', 'label:claude2@example.com'] },
            { agentId: 'claude', identity: [] },
            { agentId: 'codex', identity: ['id:acct-2'] },
        ])).toEqual([0, 3, 4]);
    });
});
