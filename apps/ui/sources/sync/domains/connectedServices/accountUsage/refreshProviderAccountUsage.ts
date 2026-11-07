import type { ProviderAccountUsageSnapshotV1 } from '@happier-dev/protocol';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import {
    getProviderAccountUsageSnapshotSealed,
    requestProviderAccountUsageRefreshSealed,
} from '@/sync/api/account/apiProviderAccountUsageV2';
import {
    getProviderAccountUsageSnapshotPlain,
    requestProviderAccountUsageRefreshPlain,
} from '@/sync/api/account/apiProviderAccountUsageV3';
import type { ConnectedServiceQuotaReadMetadata } from '@/sync/api/account/connectedServiceQuotaReadMetadata';
import type { CredentialScopedAccountMode } from '@/sync/domains/connectedServices/connectedServiceQuotaSnapshotStore';

import { readProviderAccountUsageSnapshotFromCache, writeProviderAccountUsageSnapshotToCache } from './cache';
import { openProviderAccountUsageSnapshot } from './openProviderAccountUsageSnapshot';

type ProviderAccountUsageReadParams = Readonly<{
    credentials: AuthCredentials;
    recordId: string;
    mode: CredentialScopedAccountMode;
    signal?: AbortSignal;
}>;

/** The one place a stored provider account usage record is fetched and opened, with its refresh lifecycle. */
async function readProviderAccountUsage(params: ProviderAccountUsageReadParams): Promise<Readonly<{
    snapshot: ProviderAccountUsageSnapshotV1 | null;
    metadata: ConnectedServiceQuotaReadMetadata;
}> | null> {
    const opts = { signal: params.signal };
    if (params.mode === 'plain') {
        const plain = await getProviderAccountUsageSnapshotPlain(params.credentials, { recordId: params.recordId }, opts);
        if (plain) return plain;
    }
    const sealed = await getProviderAccountUsageSnapshotSealed(params.credentials, { recordId: params.recordId }, opts);
    return sealed ? { snapshot: await openProviderAccountUsageSnapshot(params.credentials, sealed.sealed), metadata: sealed.metadata } : null;
}

export async function fetchProviderAccountUsageSnapshot(params: ProviderAccountUsageReadParams): Promise<ProviderAccountUsageSnapshotV1 | null> {
    return (await readProviderAccountUsage(params))?.snapshot ?? null;
}

const REFRESH_POLL_INTERVAL_MS = 3_000;
// The ordinary account-usage poll re-reads on this cadence anyway (see useProviderAccountUsageSnapshots),
// so waiting longer than one of its periods adds nothing.
const REFRESH_WAIT_MS = 30_000;

type RefreshParams = Readonly<{
    credentials: AuthCredentials;
    credentialScope: string;
    recordId: string;
    mode: CredentialScopedAccountMode;
}>;

const refreshes = new Map<string, Promise<boolean>>();
const refreshListeners = new Map<string, Set<() => void>>();
const refreshKey = (credentialScope: string, recordId: string) => JSON.stringify([credentialScope, recordId]);

export function isProviderAccountUsageRefreshing(credentialScope: string, recordId: string): boolean {
    return refreshes.has(refreshKey(credentialScope, recordId));
}

export function subscribeProviderAccountUsageRefresh(credentialScope: string, recordId: string, listener: () => void): () => void {
    const key = refreshKey(credentialScope, recordId);
    const listeners = refreshListeners.get(key) ?? new Set<() => void>();
    refreshListeners.set(key, listeners);
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) refreshListeners.delete(key);
    };
}

/** Shared lifecycle of the actual request and freshness wait, including failure and timeout. */
export function refreshProviderAccountUsage(params: RefreshParams): Promise<boolean> {
    const key = refreshKey(params.credentialScope, params.recordId);
    const existing = refreshes.get(key);
    if (existing) return existing;
    const publish = () => { for (const listener of refreshListeners.get(key) ?? []) listener(); };
    const promise = Promise.resolve().then(() => performProviderAccountUsageRefresh(params)).finally(() => {
        refreshes.delete(key);
        publish();
    });
    refreshes.set(key, promise);
    publish();
    return promise;
}

/**
 * Asks the server to have the owning daemon re-query the provider for this record, then
 * publishes any newer snapshot to the shared cache. The refresh is finished once the server
 * clears its refresh request, as for connected-service quotas. Resolves false when the request
 * was refused, the server records the refresh as failed, or it does not settle within one poll period.
 */
async function performProviderAccountUsageRefresh(params: RefreshParams): Promise<boolean> {
    const previousFetchedAtMs = readProviderAccountUsageSnapshotFromCache({
        credentialScope: params.credentialScope,
        recordId: params.recordId,
    })?.fetchedAtMs ?? 0;
    let requested = params.mode === 'plain'
        ? await requestProviderAccountUsageRefreshPlain(params.credentials, { recordId: params.recordId })
        : false;
    if (!requested) requested = await requestProviderAccountUsageRefreshSealed(params.credentials, { recordId: params.recordId });
    if (!requested) return false;

    const deadlineMs = Date.now() + REFRESH_WAIT_MS;
    while (Date.now() < deadlineMs) {
        await new Promise((resolve) => setTimeout(resolve, REFRESH_POLL_INTERVAL_MS));
        const read = await readProviderAccountUsage({
            credentials: params.credentials,
            recordId: params.recordId,
            mode: params.mode,
        });
        const snapshot = read?.snapshot ?? null;
        if (snapshot && snapshot.fetchedAtMs > previousFetchedAtMs) {
            writeProviderAccountUsageSnapshotToCache({ credentialScope: params.credentialScope, snapshot });
            return read?.metadata.status !== 'error';
        }
        // The daemon clears the request when it finishes, including when the provider query failed.
        if (read && read.metadata.refreshRequestedAt === undefined) return read.metadata.status !== 'error';
    }
    return false;
}
