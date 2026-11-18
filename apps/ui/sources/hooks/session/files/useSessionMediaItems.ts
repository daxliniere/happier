import * as React from 'react';

import { sync } from '@/sync/sync';
import { useSessionMessages } from '@/sync/store/hooks';
import {
    collectSessionMediaItems,
    type SessionMediaGalleryItem,
} from '@/sync/domains/sessionMedia/collectSessionMediaItems';

const NO_MEDIA_ITEMS: readonly SessionMediaGalleryItem[] = Object.freeze([]);
// The transcript's own older-page load owns an in-flight request; wait for it to settle, then resume.
const IN_FLIGHT_RETRY_MS = 250;

/**
 * Session-wide media for the Files "Session" tab. The transcript only holds the newest pages until
 * the user scrolls up, so while the tab is presented this pages the older history in through the
 * canonical `sync.loadOlderMessages` until it is exhausted; the collector then sees the whole session.
 * The subscription, the paging and the scan only exist while `enabled`, so the closed tab costs nothing.
 */
export function useSessionMediaItems(sessionId: string, enabled: boolean): Readonly<{
    items: readonly SessionMediaGalleryItem[];
    isLoaded: boolean;
    isLoadingHistory: boolean;
}> {
    const { messages, isLoaded } = useSessionMessages(sessionId, { enabled });
    const [historyExhaustedFor, setHistoryExhaustedFor] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!enabled) return;
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | null = null;

        const loadNextPage = async () => {
            const result = await sync.loadOlderMessages(sessionId).catch(() => null);
            if (cancelled) return;
            if (result?.status === 'in_flight') {
                retryTimer = setTimeout(() => { void loadNextPage(); }, IN_FLIGHT_RETRY_MS);
                return;
            }
            if (result?.status === 'loaded' && result.hasMore) {
                void loadNextPage();
                return;
            }
            // no_more, not_ready or a failed load: show what the transcript holds.
            setHistoryExhaustedFor(sessionId);
        };
        void loadNextPage();

        return () => {
            cancelled = true;
            if (retryTimer !== null) clearTimeout(retryTimer);
        };
    }, [enabled, sessionId]);

    const items = React.useMemo(
        () => (enabled ? collectSessionMediaItems(messages) : NO_MEDIA_ITEMS),
        [enabled, messages],
    );
    return { items, isLoaded, isLoadingHistory: enabled && historyExhaustedFor !== sessionId };
}
