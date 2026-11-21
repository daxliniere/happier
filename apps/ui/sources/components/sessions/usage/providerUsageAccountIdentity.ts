/**
 * Who an observed usage snapshot belongs to: the provider's account subject when known, else
 * its email-style label. Null when the snapshot does not say (such entries are never merged).
 */
export function resolveProviderUsageAccountIdentity(snapshot: Readonly<{
    activeAccountId?: string | null;
    accountLabel?: string | null;
}> | null | undefined): string | null {
    const id = snapshot?.activeAccountId?.trim();
    if (id) return `id:${id}`;
    const label = snapshot?.accountLabel?.trim().toLowerCase();
    return label ? `label:${label}` : null;
}

/**
 * Indices of the entries to show: one per provider login. The same login can appear twice, for
 * example as a connected profile and as the native login a default account resolves to; the first
 * (connected) entry is kept so its usage is not shown twice.
 */
export function selectDistinctProviderUsageAccounts(entries: ReadonlyArray<Readonly<{
    agentId: string;
    identity: string | null;
}>>): number[] {
    const seen = new Set<string>();
    const kept: number[] = [];
    entries.forEach((entry, index) => {
        if (entry.identity) {
            const key = `${entry.agentId}\u0000${entry.identity}`;
            if (seen.has(key)) return;
            seen.add(key);
        }
        kept.push(index);
    });
    return kept;
}
