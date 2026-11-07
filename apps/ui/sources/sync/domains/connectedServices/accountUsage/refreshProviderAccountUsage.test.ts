import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProviderAccountUsageSnapshotV1 } from '@happier-dev/protocol';

import type { AuthCredentials } from '@/auth/storage/tokenStorage';

const api = vi.hoisted(() => ({
    getPlain: vi.fn(),
    getSealed: vi.fn(),
    requestPlain: vi.fn(),
    requestSealed: vi.fn(),
}));

vi.mock('@/sync/api/account/apiProviderAccountUsageV3', () => ({
    getProviderAccountUsageSnapshotPlain: api.getPlain,
    requestProviderAccountUsageRefreshPlain: api.requestPlain,
}));
vi.mock('@/sync/api/account/apiProviderAccountUsageV2', () => ({
    getProviderAccountUsageSnapshotSealed: api.getSealed,
    requestProviderAccountUsageRefreshSealed: api.requestSealed,
}));

import { __resetProviderAccountUsageSnapshotCache, readProviderAccountUsageSnapshotFromCache } from './cache';
import { isProviderAccountUsageRefreshing, refreshProviderAccountUsage } from './refreshProviderAccountUsage';

const credentials = { token: 't', secret: 's' } as unknown as AuthCredentials;
const recordId = 'paug_v1_abcdefgh';
const snapshot = (fetchedAtMs: number) => ({ recordId, fetchedAtMs }) as unknown as ProviderAccountUsageSnapshotV1;
/** A server read: the snapshot plus its refresh lifecycle markers. */
const read = (fetchedAtMs: number, markers: Readonly<{ pending?: boolean; status?: 'ok' | 'error' }> = {}) => ({
    snapshot: snapshot(fetchedAtMs),
    metadata: {
        fetchedAt: fetchedAtMs, staleAfterMs: 60_000, status: markers.status ?? 'ok',
        ...(markers.pending === false ? {} : { refreshRequestedAt: 1 }),
    },
});

describe('refreshProviderAccountUsage', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        __resetProviderAccountUsageSnapshotCache();
        Object.values(api).forEach((fn) => fn.mockReset());
    });
    afterEach(() => vi.useRealTimers());

    it('requests a refresh, then publishes the first snapshot newer than the cached one', async () => {
        api.requestPlain.mockResolvedValue(true);
        api.getPlain.mockResolvedValueOnce(read(0)).mockResolvedValueOnce(read(5_000));

        const done = refreshProviderAccountUsage({ credentials, credentialScope: 'scope', recordId, mode: 'plain' });
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(done).resolves.toBe(true);
        expect(api.requestPlain).toHaveBeenCalledTimes(1);
        expect(readProviderAccountUsageSnapshotFromCache({ credentialScope: 'scope', recordId })?.fetchedAtMs).toBe(5_000);
    });

    it('does not poll when the server refuses the refresh request', async () => {
        api.requestPlain.mockResolvedValue(false);
        api.requestSealed.mockResolvedValue(false);

        await expect(refreshProviderAccountUsage({ credentials, credentialScope: 'scope', recordId, mode: 'plain' })).resolves.toBe(false);
        expect(api.getPlain).not.toHaveBeenCalled();
        expect(isProviderAccountUsageRefreshing('scope', recordId)).toBe(false);
    });

    it('shares the real pending operation and clears its indicator when no fresh usage arrives', async () => {
        api.requestPlain.mockResolvedValue(true);
        api.getPlain.mockResolvedValue(read(0));
        const params = { credentials, credentialScope: 'scope', recordId, mode: 'plain' as const };
        const done = refreshProviderAccountUsage(params);
        expect(refreshProviderAccountUsage(params)).toBe(done);
        expect(isProviderAccountUsageRefreshing('scope', recordId)).toBe(true);
        expect(isProviderAccountUsageRefreshing('other-account', recordId)).toBe(false);
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(done).resolves.toBe(false);
        expect(isProviderAccountUsageRefreshing('scope', recordId)).toBe(false);
        expect(api.requestPlain).toHaveBeenCalledTimes(1);
    });

    it('settles as soon as the server clears its refresh request, without newer usage', async () => {
        api.requestPlain.mockResolvedValue(true);
        api.getPlain.mockResolvedValueOnce(read(0)).mockResolvedValue(read(0, { pending: false }));
        const done = refreshProviderAccountUsage({ credentials, credentialScope: 'scope', recordId, mode: 'plain' });
        await vi.advanceTimersByTimeAsync(6_000);
        expect(isProviderAccountUsageRefreshing('scope', recordId)).toBe(false);
        await expect(done).resolves.toBe(true);
    });

    it('ends a refresh the server reports as failed instead of waiting out the poll period', async () => {
        api.requestPlain.mockResolvedValue(true);
        api.getPlain.mockResolvedValueOnce(read(0)).mockResolvedValue(read(0, { pending: false, status: 'error' }));
        const done = refreshProviderAccountUsage({ credentials, credentialScope: 'scope', recordId, mode: 'plain' });
        await vi.advanceTimersByTimeAsync(6_000);
        expect(isProviderAccountUsageRefreshing('scope', recordId)).toBe(false);
        await expect(done).resolves.toBe(false);
    });

    it('clears its indicator when the refresh request throws', async () => {
        api.requestPlain.mockRejectedValue(new Error('offline'));
        await expect(refreshProviderAccountUsage({ credentials, credentialScope: 'scope', recordId, mode: 'plain' })).rejects.toThrow('offline');
        expect(isProviderAccountUsageRefreshing('scope', recordId)).toBe(false);
    });
});
