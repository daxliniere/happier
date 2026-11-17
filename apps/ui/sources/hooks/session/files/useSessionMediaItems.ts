import * as React from 'react';

import { useSessionMessages } from '@/sync/store/hooks';
import {
    collectSessionMediaItems,
    type SessionMediaGalleryItem,
} from '@/sync/domains/sessionMedia/collectSessionMediaItems';

const NO_MEDIA_ITEMS: readonly SessionMediaGalleryItem[] = Object.freeze([]);

/**
 * Session-wide media for the Files "Session" tab. The transcript subscription and the scan only
 * exist while the tab is presented (`enabled`), so the closed tab costs nothing.
 */
export function useSessionMediaItems(sessionId: string, enabled: boolean): Readonly<{
    items: readonly SessionMediaGalleryItem[];
    isLoaded: boolean;
}> {
    const { messages, isLoaded } = useSessionMessages(sessionId, { enabled });
    const items = React.useMemo(
        () => (enabled ? collectSessionMediaItems(messages) : NO_MEDIA_ITEMS),
        [enabled, messages],
    );
    return { items, isLoaded };
}
