import { describe, expect, it } from 'vitest';

import type { SessionRuntimeIssueV1 } from '@happier-dev/protocol';

import { selectedAccountClearsUsageLimit } from './selectedAccountClearsUsageLimit';

function limitIssue(connectedService: { serviceId: string; profileId: string | null; groupId: string | null } | null): SessionRuntimeIssueV1 {
    return {
        v: 1, scope: 'primary_session', status: 'failed', code: 'usage_limit', source: 'usage_limit', occurredAt: 1,
        provider: 'claude',
        usageLimit: {
            v: 1, resetAtMs: 5_000, retryAfterMs: null, quotaScope: 'account', recoverability: 'wait',
            ...(connectedService ? { connectedService } : {}),
        },
    } as SessionRuntimeIssueV1;
}

const claude1Limited = limitIssue({ serviceId: 'claude-subscription', profileId: 'Claude1', groupId: null });
const selectedClaude2 = { serviceId: 'claude-subscription', profileId: 'Claude2' } as const;
const usage = (overrides: Partial<{ profileId: string | null; isStale: boolean; rows: Array<{ remainingPct: number | null }> }> = {}) => ({
    profileId: 'Claude2', isStale: false, rows: [{ remainingPct: 18 }, { remainingPct: 24 }], ...overrides,
});

describe('selectedAccountClearsUsageLimit', () => {
    it('clears a limit that another account hit when the selected account still has capacity', () => {
        expect(selectedAccountClearsUsageLimit({ issue: claude1Limited, selected: selectedClaude2, usage: usage() })).toBe(true);
    });

    it('does not clear a limit hit by the selected account itself', () => {
        const ownLimit = limitIssue({ serviceId: 'claude-subscription', profileId: 'Claude2', groupId: null });

        expect(selectedAccountClearsUsageLimit({ issue: ownLimit, selected: selectedClaude2, usage: usage() })).toBe(false);
    });

    it('does not clear anything while the selected account is itself exhausted in any window', () => {
        expect(selectedAccountClearsUsageLimit({
            issue: claude1Limited, selected: selectedClaude2, usage: usage({ rows: [{ remainingPct: 18 }, { remainingPct: 0 }] }),
        })).toBe(false);
    });

    it('does not guess from usage that is stale, unknown, or describes a different account', () => {
        for (const u of [usage({ isStale: true }), usage({ profileId: 'Claude1' }), usage({ profileId: null }), usage({ rows: [] }), usage({ rows: [{ remainingPct: null }] }), null]) {
            expect(selectedAccountClearsUsageLimit({ issue: claude1Limited, selected: selectedClaude2, usage: u })).toBe(false);
        }
    });

    it('only applies to a limit reported for a single connected profile', () => {
        const pool = limitIssue({ serviceId: 'claude-subscription', profileId: null, groupId: 'pool' });
        const native = limitIssue(null);

        expect(selectedAccountClearsUsageLimit({ issue: pool, selected: selectedClaude2, usage: usage() })).toBe(false);
        expect(selectedAccountClearsUsageLimit({ issue: native, selected: selectedClaude2, usage: usage() })).toBe(false);
        expect(selectedAccountClearsUsageLimit({ issue: null, selected: selectedClaude2, usage: usage() })).toBe(false);
    });

    it('does not apply when the session has no single selected profile or it is another service', () => {
        expect(selectedAccountClearsUsageLimit({ issue: claude1Limited, selected: null, usage: usage() })).toBe(false);
        expect(selectedAccountClearsUsageLimit({
            issue: claude1Limited, selected: { serviceId: 'openai-codex', profileId: 'Claude2' }, usage: usage(),
        })).toBe(false);
    });
});
