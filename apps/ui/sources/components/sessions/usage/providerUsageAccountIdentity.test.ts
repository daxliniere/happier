import { describe, expect, it } from 'vitest';

import { resolveProviderUsageAccountIdentity, selectDistinctProviderUsageAccounts } from './providerUsageAccountIdentity';

describe('provider usage account identity', () => {
    it('identifies an account by its provider subject, falling back to its email label', () => {
        expect(resolveProviderUsageAccountIdentity({ activeAccountId: 'acct-2', accountLabel: 'Claude2@Example.com' })).toBe('id:acct-2');
        expect(resolveProviderUsageAccountIdentity({ accountLabel: ' Claude2@Example.com ' })).toBe('label:claude2@example.com');
        expect(resolveProviderUsageAccountIdentity(null)).toBeNull();
        expect(resolveProviderUsageAccountIdentity({ accountLabel: null })).toBeNull();
    });

    it('keeps the first entry of each provider login and drops later duplicates', () => {
        const kept = selectDistinctProviderUsageAccounts([
            { agentId: 'claude', identity: 'label:claude1@example.com' },
            { agentId: 'claude', identity: 'label:claude2@example.com' },
            // The native login is the same person as the connected Claude-2 profile.
            { agentId: 'claude', identity: 'label:claude2@example.com' },
            // Unknown identity is never merged.
            { agentId: 'claude', identity: null },
            // The same login under another provider is that provider's own entry.
            { agentId: 'codex', identity: 'label:claude2@example.com' },
        ]);
        expect(kept).toEqual([0, 1, 3, 4]);
    });
});
