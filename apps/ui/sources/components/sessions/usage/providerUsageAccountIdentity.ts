/**
 * The forms under which an observed usage snapshot names its login: the provider's account
 * subject and/or its email-style label. Empty when the snapshot says neither (never merged).
 */
export function resolveProviderUsageAccountIdentity(snapshot: Readonly<{
    activeAccountId?: string | null;
    accountLabel?: string | null;
}> | null | undefined): readonly string[] {
    const keys: string[] = [];
    const id = snapshot?.activeAccountId?.trim();
    if (id) keys.push(`id:${id}`);
    const label = snapshot?.accountLabel?.trim().toLowerCase();
    if (label) keys.push(`label:${label}`);
    return keys;
}

/**
 * Indices of the entries to show: one per provider login. The same login can appear twice, for
 * example as a connected profile and as the native login a default account resolves to; the first
 * (connected) entry is kept so its usage is not shown twice. Two entries are the same login when
 * they share any identity form, so one known by id and one known only by email still match.
 */
export function selectDistinctProviderUsageAccounts(entries: ReadonlyArray<Readonly<{
    agentId: string;
    identity: readonly string[];
}>>): number[] {
    const seen = new Set<string>();
    const kept: number[] = [];
    entries.forEach((entry, index) => {
        const keys = entry.identity.map((key) => `${entry.agentId}\u0000${key}`);
        if (keys.some((key) => seen.has(key))) {
            // Remember this duplicate's other forms too, so a third entry known only by them still matches.
            for (const key of keys) seen.add(key);
            return;
        }
        for (const key of keys) seen.add(key);
        kept.push(index);
    });
    return kept;
}
