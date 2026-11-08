import * as React from 'react';

import { useKeyboardShortcutHandlers } from '@/keyboard/KeyboardShortcutProvider';
import type { KeyboardShortcutHandlers } from '@/keyboard/runtime';

import { useTranscriptRootMessages } from '../items/useTranscriptRootMessages';
import type { TranscriptJumpResult, TranscriptJumpTarget } from '../viewport/jump/transcriptJumpTargetTypes';
import { TranscriptFindBar } from './TranscriptFindBar';
import type { TranscriptFindMatch } from './transcriptFindMatches';
import { useTranscriptFind } from './useTranscriptFind';

type RevealTranscriptMessage = (target: TranscriptJumpTarget) => Promise<TranscriptJumpResult>;

const NO_HANDLERS: KeyboardShortcutHandlers = {};

/**
 * Find-in-transcript for one session. Closed, it only owns the Mod+F handler; the message
 * subscription and matching mount with the bar, so an unused Find costs nothing.
 */
export const TranscriptFind = React.memo(function TranscriptFind(props: Readonly<{
    sessionId: string;
    /** False for hidden keep-alive transcripts, which must not answer the shortcut. */
    enabled: boolean;
    revealMessage: RevealTranscriptMessage;
}>) {
    // 0 means closed; each request increments it so a repeat shortcut refocuses the open bar.
    const [focusRequest, setFocusRequest] = React.useState(0);
    const handlers = React.useMemo<KeyboardShortcutHandlers>(() => (
        props.enabled
            ? { 'find.open': () => setFocusRequest((current) => current + 1) }
            : NO_HANDLERS
    ), [props.enabled]);
    useKeyboardShortcutHandlers(handlers);
    const close = React.useCallback(() => setFocusRequest(0), []);

    if (focusRequest === 0 || !props.enabled) return null;
    return (
        <OpenTranscriptFind
            sessionId={props.sessionId}
            focusRequest={focusRequest}
            onClose={close}
            revealMessage={props.revealMessage}
        />
    );
});

function OpenTranscriptFind(props: Readonly<{
    sessionId: string;
    focusRequest: number;
    onClose: () => void;
    revealMessage: RevealTranscriptMessage;
}>) {
    const { messageIdsOldestFirst, messagesById } = useTranscriptRootMessages(props.sessionId);
    const [query, setQuery] = React.useState('');
    const { revealMessage } = props;
    const jumpToMatch = React.useCallback((match: TranscriptFindMatch) => {
        void revealMessage({
            kind: 'route-message-id',
            routeMessageId: match.routeMessageId,
            seqHint: match.seq,
            transcriptBlockIndex: match.transcriptBlockIndex,
            role: match.role,
        });
    }, [revealMessage]);
    const find = useTranscriptFind({ messageIdsOldestFirst, messagesById, query, jumpToMatch });

    return (
        <TranscriptFindBar
            query={query}
            onChangeQuery={setQuery}
            find={find}
            focusRequest={props.focusRequest}
            onClose={props.onClose}
        />
    );
}
