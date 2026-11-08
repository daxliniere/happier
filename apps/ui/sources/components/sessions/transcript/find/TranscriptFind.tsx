import * as React from 'react';

import { useKeyboardShortcutHandlers } from '@/keyboard/KeyboardShortcutProvider';
import type { KeyboardShortcutHandlers } from '@/keyboard/runtime';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { useTranscriptRootMessages } from '../items/useTranscriptRootMessages';
import type { TranscriptJumpResult, TranscriptJumpTarget } from '../viewport/jump/transcriptJumpTargetTypes';
import { TranscriptFindBar } from './TranscriptFindBar';
import type { TranscriptFindMatch } from './transcriptFindMatches';
import { useTranscriptFind } from './useTranscriptFind';

type RevealTranscriptMessage = (target: TranscriptJumpTarget) => Promise<TranscriptJumpResult>;

type OlderHistory = Readonly<{
    hasMoreOlder: boolean;
    loadingOlder: boolean;
    /** The transcript's shared whole-history load (Jump to top uses the same one). */
    loadEntireTranscript: () => Promise<boolean>;
}>;

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
} & OlderHistory>) {
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
            hasMoreOlder={props.hasMoreOlder}
            loadingOlder={props.loadingOlder}
            loadEntireTranscript={props.loadEntireTranscript}
        />
    );
});

function OpenTranscriptFind(props: Readonly<{
    sessionId: string;
    focusRequest: number;
    onClose: () => void;
    revealMessage: RevealTranscriptMessage;
} & OlderHistory>) {
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

    // Once the whole history has loaded, the next render holds the older messages; restart there so
    // the search lands on its new first match instead of a stale one.
    const [restartRequest, setRestartRequest] = React.useState(0);
    const restartRef = React.useRef(find.restart);
    restartRef.current = find.restart;
    React.useEffect(() => {
        if (restartRequest > 0) restartRef.current();
    }, [restartRequest]);
    const { loadEntireTranscript } = props;
    const expandSearch = React.useCallback(() => {
        fireAndForget(loadEntireTranscript().then((loaded) => {
            if (loaded) setRestartRequest((current) => current + 1);
        }), { tag: 'TranscriptFind.expandSearch' });
    }, [loadEntireTranscript]);
    const expand = React.useMemo(() => ({
        available: props.hasMoreOlder,
        loading: props.loadingOlder,
        onPress: expandSearch,
    }), [expandSearch, props.hasMoreOlder, props.loadingOlder]);

    return (
        <TranscriptFindBar
            query={query}
            onChangeQuery={setQuery}
            find={find}
            focusRequest={props.focusRequest}
            onClose={props.onClose}
            expand={expand}
        />
    );
}
