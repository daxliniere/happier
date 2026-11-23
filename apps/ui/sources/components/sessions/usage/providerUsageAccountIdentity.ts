/**
 * The connected login (`serviceId/profileId`) a native usage record was observed through. The daemon
 * stores a connected login's reading that carries no provider account id as a provisional record
 * named after that profile, so such a record is that connected login, not a native one.
 */
export function resolveProvisionalConnectedProfileKey(subject: Readonly<{
    kind: string;
    mergeKey?: string;
}> | null | undefined): string | null {
    if (subject?.kind !== 'provisionalLocalSubject' || !subject.mergeKey) return null;
    const separator = subject.mergeKey.indexOf(':');
    if (separator <= 0 || separator === subject.mergeKey.length - 1) return null;
    return `${subject.mergeKey.slice(0, separator)}/${subject.mergeKey.slice(separator + 1)}`;
}

/**
 * The forms under which an observed usage snapshot names its login: the provider's account
 * subject and/or its email-style label. Empty when the snapshot says neither (never merged).
 */
export function resolveProviderUsageAccountIdentity(snapshot: Readonly<{
    activeAccountId?: string | null;
    accountLabel?: string | null;
}> | null | undefined, connectedProfileKey?: string | null): readonly string[] {
    const keys: string[] = [];
    // The connected login an entry is, or was observed through (`serviceId/profileId`).
    if (connectedProfileKey) keys.push(`profile:${connectedProfileKey}`);
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
