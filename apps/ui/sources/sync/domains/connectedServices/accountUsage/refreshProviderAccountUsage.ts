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
import type { CredentialScopedAccountMode } from '@/sync/domains/connectedServices/connectedServiceQuotaSnapshotStore';

import { readProviderAccountUsageSnapshotFromCache, writeProviderAccountUsageSnapshotToCache } from './cache';
import { openProviderAccountUsageSnapshot } from './openProviderAccountUsageSnapshot';

/** The one place a stored provider account usage snapshot is fetched and opened. */
export async function fetchProviderAccountUsageSnapshot(params: Readonly<{
    credentials: AuthCredentials;
    recordId: string;
    mode: CredentialScopedAccountMode;
    signal?: AbortSignal;
}>): Promise<ProviderAccountUsageSnapshotV1 | null> {
    const opts = { signal: params.signal };
    if (params.mode === 'plain') {
        const plain = await getProviderAccountUsageSnapshotPlain(params.credentials, { recordId: params.recordId }, opts);
        if (plain) return plain;
    }
    const sealed = await getProviderAccountUsageSnapshotSealed(params.credentials, { recordId: params.recordId }, opts);
    return sealed ? openProviderAccountUsageSnapshot(params.credentials, sealed.sealed) : null;
}

const REFRESH_POLL_INTERVAL_MS = 3_000;
// The ordinary account-usage poll re-reads on this cadence anyway (see useProviderAccountUsageSnapshots),
// so waiting longer than one of its periods adds nothing.
const REFRESH_WAIT_MS = 30_000;

/**
 * Asks the server to have the owning daemon re-query the provider for this record, then
 * waits for the newer snapshot and publishes it to the shared cache. Resolves false when
 * the request was refused or no newer snapshot arrived within one poll period.
 */
export async function refreshProviderAccountUsage(params: Readonly<{
    credentials: AuthCredentials;
    credentialScope: string;
    recordId: string;
    mode: CredentialScopedAccountMode;
}>): Promise<boolean> {
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
        const snapshot = await fetchProviderAccountUsageSnapshot({
            credentials: params.credentials,
            recordId: params.recordId,
            mode: params.mode,
        });
        if (snapshot && snapshot.fetchedAtMs > previousFetchedAtMs) {
            writeProviderAccountUsageSnapshotToCache({ credentialScope: params.credentialScope, snapshot });
            return true;
        }
    }
    return false;
}
