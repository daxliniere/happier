import { buildMessageRouteId } from '@/sync/domains/messages/messageRouteIds';
import type { Message } from '@/sync/domains/messages/messageTypes';

import {
    resolveTranscriptMessageRole,
    resolveTranscriptMessageText,
} from '../navigation/buildTranscriptNavigationLoadedMessages';
import type { TranscriptJumpTargetRole } from '../viewport/jump/transcriptJumpTargetTypes';

/** One message containing the query, with the identity the transcript jump needs to reveal it. */
export type TranscriptFindMatch = Readonly<{
    messageId: string;
    routeMessageId: string;
    seq: number;
    transcriptBlockIndex: number | null;
    role: TranscriptJumpTargetRole;
}>;

// Lower-cased searchable text per message object. Message objects are replaced when they change,
// so a streaming transcript only recomputes the rows that actually moved.
const searchableTextByMessage = new WeakMap<Message, string>();

function collectToolSearchText(message: Extract<Message, { kind: 'tool-call' }>): string {
    const parts: string[] = [message.tool.name];
    if (message.tool.description) parts.push(message.tool.description);
    const input: unknown = message.tool.input;
    if (input && typeof input === 'object') {
        for (const value of Object.values(input)) {
            if (typeof value === 'string') parts.push(value);
        }
    }
    return parts.join('\n');
}

function readSearchableText(message: Message): string {
    const cached = searchableTextByMessage.get(message);
    if (cached !== undefined) return cached;
    const text = message.kind === 'tool-call'
        ? collectToolSearchText(message)
        : resolveTranscriptMessageText(message) ?? '';
    const lowered = text.toLowerCase();
    searchableTextByMessage.set(message, lowered);
    return lowered;
}

export function findTranscriptMessageMatches(params: Readonly<{
    messageIdsOldestFirst: readonly string[];
    messagesById: Readonly<Record<string, Message>>;
    query: string;
}>): TranscriptFindMatch[] {
    const needle = params.query.trim().toLowerCase();
    if (needle.length === 0) return [];

    const matches: TranscriptFindMatch[] = [];
    for (const messageId of params.messageIdsOldestFirst) {
        const message = params.messagesById[messageId];
        // A message without a seq is not yet committed and cannot be a jump target.
        if (!message || typeof message.seq !== 'number' || !Number.isFinite(message.seq)) continue;
        if (!readSearchableText(message).includes(needle)) continue;
        matches.push({
            messageId,
            routeMessageId: buildMessageRouteId(message),
            seq: Math.trunc(message.seq),
            transcriptBlockIndex: typeof message.transcriptBlockIndex === 'number' ? message.transcriptBlockIndex : null,
            role: resolveTranscriptMessageRole(message),
        });
    }
    return matches;
}
