import type { SessionRuntimeIssueV1 } from '@happier-dev/protocol';

/** The usage of one account, as the gauge reports it: only what the capacity decision needs. */
export type SelectedAccountUsage = Readonly<{
    /** The account these figures describe. */
    profileId: string | null | undefined;
    isStale: boolean;
    rows: ReadonlyArray<Readonly<{ remainingPct: number | null }>>;
}>;

/**
 * Whether a stored usage-limit issue no longer applies to this session because the session is now
 * set to a DIFFERENT account that is shown to have capacity.
 *
 * The limit issue names the account that hit the limit. When the owner moves the session to another
 * account, waiting out that first account's reset only delays a session that could resume at once.
 * This is deliberately narrow: a single-profile limit, a different single profile selected on the
 * same service, and fresh figures for exactly that account with every known window above zero.
 * Anything unknown (pool limits, native auth, stale or missing figures, another account's figures)
 * keeps the existing wait, so the banner never claims capacity it has not seen.
 */
export function selectedAccountClearsUsageLimit(params: Readonly<{
    issue: SessionRuntimeIssueV1 | null | undefined;
    selected: Readonly<{ serviceId: string; profileId: string }> | null | undefined;
    usage: SelectedAccountUsage | null | undefined;
}>): boolean {
    const source = params.issue?.usageLimit?.connectedService;
    const { selected, usage } = params;
    if (!source || source.groupId || !source.profileId) return false;
    if (!selected || selected.serviceId !== source.serviceId || selected.profileId === source.profileId) return false;
    if (!usage || usage.isStale || usage.profileId !== selected.profileId) return false;
    const known = usage.rows
        .map((row) => row.remainingPct)
        .filter((remaining): remaining is number => typeof remaining === 'number');
    return known.length > 0 && known.every((remaining) => remaining > 0);
}
