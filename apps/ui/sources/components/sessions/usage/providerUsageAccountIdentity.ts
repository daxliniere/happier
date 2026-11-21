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
 * Indices of the entries to show: one per provider login, in their original order. The same login
 * can appear more than once, for example as a connected profile and as the native login a default
 * account resolves to. Entries of one provider that share any identity form, directly or through
 * other entries, are one login; its earliest (connected) entry is kept. Entries with no identity
 * are never merged.
 */
export function selectDistinctProviderUsageAccounts(entries: ReadonlyArray<Readonly<{
    agentId: string;
    identity: readonly string[];
}>>): number[] {
    // Union entries that share an identity key (scoped to their provider).
    const parent = entries.map((_, index) => index);
    const find = (index: number): number => {
        while (parent[index] !== index) {
            parent[index] = parent[parent[index]!]!;
            index = parent[index]!;
        }
        return index;
    };
    const ownerByKey = new Map<string, number>();
    entries.forEach((entry, index) => {
        for (const key of entry.identity) {
            const scoped = `${entry.agentId}\u0000${key}`;
            const owner = ownerByKey.get(scoped);
            if (owner === undefined) {
                ownerByKey.set(scoped, index);
                continue;
            }
            const [left, right] = [find(owner), find(index)];
            if (left !== right) parent[Math.max(left, right)] = Math.min(left, right);
        }
    });
    // The root of each group is its earliest entry.
    return entries.map((_, index) => index).filter((index) => find(index) === index);
}
