import { describe, expect, it } from 'vitest';

import { createToolCallMessageFixture } from '@/dev/testkit';
import type { Message } from '@/sync/domains/messages/messageTypes';

import { findTranscriptMessageMatches } from './transcriptFindMatches';

function user(id: string, seq: number | undefined, text: string): Message {
    return { kind: 'user-text', id, realID: id, seq, localId: null, createdAt: seq ?? 0, text };
}

function agent(id: string, seq: number, text: string, isThinking = false): Message {
    return { kind: 'agent-text', id, realID: id, seq, localId: null, createdAt: seq, text, isThinking };
}

function corpus(messages: readonly Message[]) {
    return {
        messageIdsOldestFirst: messages.map((message) => message.id),
        messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
    };
}

describe('findTranscriptMessageMatches', () => {
    it('matches user and agent text case-insensitively, oldest first, with jumpable identities', () => {
        const matches = findTranscriptMessageMatches({
            ...corpus([
                user('m1', 1, 'Please fix the Login page'),
                agent('m2', 2, 'Nothing relevant here'),
                agent('m3', 3, 'The login form now validates'),
            ]),
            query: 'LOGIN',
        });

        expect(matches.map((match) => match.routeMessageId)).toEqual(['server:m1', 'server:m3']);
        expect(matches[0]).toMatchObject({ messageId: 'm1', seq: 1, role: 'user' });
        expect(matches[1]).toMatchObject({ messageId: 'm3', seq: 3, role: 'assistant' });
    });

    it('matches tool names, descriptions and string inputs', () => {
        const matches = findTranscriptMessageMatches({
            ...corpus([
                createToolCallMessageFixture({
                    id: 't1',
                    realID: 't1',
                    seq: 4,
                    tool: {
                        name: 'Bash',
                        state: 'completed',
                        input: { command: 'yarn typecheck', timeout: 1000 },
                        createdAt: 4,
                        startedAt: 4,
                        completedAt: 5,
                        description: 'Run the compiler',
                    },
                }),
            ]),
            query: 'typecheck',
        });

        expect(matches.map((match) => match.messageId)).toEqual(['t1']);
        expect(matches[0]?.role).toBe('tool');
    });

    it('skips thinking, messages that cannot be jumped to, and blank queries', () => {
        const messages = corpus([
            agent('m1', 1, 'secret reasoning', true),
            user('m2', undefined, 'secret pending text'),
            user('m3', 3, 'secret visible'),
        ]);

        expect(findTranscriptMessageMatches({ ...messages, query: 'secret' }).map((match) => match.messageId)).toEqual(['m3']);
        expect(findTranscriptMessageMatches({ ...messages, query: '   ' })).toEqual([]);
    });
});
