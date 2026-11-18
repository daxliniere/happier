import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/dev/testkit';

const state = vi.hoisted(() => ({
    pages: [] as Array<Readonly<{ loaded: number; hasMore: boolean; status: string }>>,
    loadOlderMessages: vi.fn(),
}));

// Genuine boundaries: the sync engine's paging RPC and the transcript store subscription.
vi.mock('@/sync/sync', () => ({
    sync: { loadOlderMessages: (...args: unknown[]) => state.loadOlderMessages(...args) },
}));
vi.mock('@/sync/store/hooks', () => ({
    useSessionMessages: () => ({ messages: [], isLoaded: true }),
}));

describe('useSessionMediaItems', () => {
    beforeEach(() => {
        state.pages = [];
        state.loadOlderMessages.mockReset();
        state.loadOlderMessages.mockImplementation(async () => (
            state.pages.shift() ?? { loaded: 0, hasMore: false, status: 'no_more' }
        ));
    });

    it('pages the whole history in while enabled, reporting loading until it is exhausted', async () => {
        state.pages = [
            { loaded: 50, hasMore: true, status: 'loaded' },
            { loaded: 50, hasMore: true, status: 'loaded' },
            { loaded: 10, hasMore: false, status: 'loaded' },
        ];
        const { useSessionMediaItems } = await import('./useSessionMediaItems');
        const hook = await renderHook(() => useSessionMediaItems('s1', true));

        expect(state.loadOlderMessages).toHaveBeenCalledTimes(3);
        expect(state.loadOlderMessages).toHaveBeenCalledWith('s1');
        expect(hook.getCurrent().isLoadingHistory).toBe(false);
    });

    it('does not touch the transcript paging while disabled', async () => {
        const { useSessionMediaItems } = await import('./useSessionMediaItems');
        await renderHook(() => useSessionMediaItems('s1', false));

        expect(state.loadOlderMessages).not.toHaveBeenCalled();
    });
});
