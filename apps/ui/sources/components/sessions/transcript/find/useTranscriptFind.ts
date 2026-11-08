import * as React from 'react';

import type { Message } from '@/sync/domains/messages/messageTypes';

import { findTranscriptMessageMatches, type TranscriptFindMatch } from './transcriptFindMatches';

export type TranscriptFindState = Readonly<{
    total: number;
    /** Index into the oldest-first match list, or null when nothing matches. */
    activeIndex: number | null;
    goOlder: () => void;
    goNewer: () => void;
}>;

type Selection = Readonly<{ query: string; routeMessageId: string }>;

/**
 * Find-in-transcript state, browser-style and matching 0.3's Find: a new query lands on the first
 * (oldest loaded) match, next moves newer, previous moves older, and both wrap. The selected match
 * is held by identity, so messages streaming in keep the current match instead of moving the reader.
 */
export function useTranscriptFind(params: Readonly<{
    messageIdsOldestFirst: readonly string[];
    messagesById: Readonly<Record<string, Message>>;
    query: string;
    jumpToMatch: (match: TranscriptFindMatch) => void;
}>): TranscriptFindState {
    const { messageIdsOldestFirst, messagesById, query } = params;
    const normalizedQuery = query.trim().toLowerCase();
    const matches = React.useMemo(
        () => findTranscriptMessageMatches({ messageIdsOldestFirst, messagesById, query: normalizedQuery }),
        [messageIdsOldestFirst, messagesById, normalizedQuery],
    );
    const [selection, setSelection] = React.useState<Selection | null>(null);

    let activeIndex: number | null = null;
    if (matches.length > 0) {
        const selectedIndex = selection?.query === normalizedQuery
            ? matches.findIndex((match) => match.routeMessageId === selection.routeMessageId)
            : -1;
        activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    }
    const activeMatch = activeIndex === null ? null : matches[activeIndex] ?? null;

    const jumpToMatchRef = React.useRef(params.jumpToMatch);
    jumpToMatchRef.current = params.jumpToMatch;
    const lastJumpedRouteMessageIdRef = React.useRef<string | null>(null);
    const jump = React.useCallback((match: TranscriptFindMatch) => {
        lastJumpedRouteMessageIdRef.current = match.routeMessageId;
        jumpToMatchRef.current(match);
    }, []);

    // Typing reveals the first match; an unchanged active match (new messages, same query) stays put.
    const activeRouteMessageId = activeMatch?.routeMessageId ?? null;
    React.useEffect(() => {
        if (!activeMatch) {
            lastJumpedRouteMessageIdRef.current = null;
            return;
        }
        if (lastJumpedRouteMessageIdRef.current === activeMatch.routeMessageId) return;
        jump(activeMatch);
        // activeMatch is identified by its route id; a new object for the same message is not a move.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeRouteMessageId, jump]);

    const step = React.useCallback((delta: -1 | 1) => {
        if (activeIndex === null || matches.length === 0) return;
        const nextIndex = (activeIndex + delta + matches.length) % matches.length;
        const next = matches[nextIndex];
        if (!next) return;
        setSelection({ query: normalizedQuery, routeMessageId: next.routeMessageId });
        // Stepping always reveals, even onto the same message after the reader scrolled away.
        jump(next);
    }, [activeIndex, jump, matches, normalizedQuery]);

    const goOlder = React.useCallback(() => step(-1), [step]);
    const goNewer = React.useCallback(() => step(1), [step]);

    return { total: matches.length, activeIndex, goOlder, goNewer };
}
