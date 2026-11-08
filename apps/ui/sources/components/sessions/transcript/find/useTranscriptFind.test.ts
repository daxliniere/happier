import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderHook, standardCleanup } from '@/dev/testkit';
import type { Message } from '@/sync/domains/messages/messageTypes';

import type { TranscriptFindMatch } from './transcriptFindMatches';
import { useTranscriptFind } from './useTranscriptFind';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(standardCleanup);

function user(id: string, seq: number, text: string): Message {
    return { kind: 'user-text', id, realID: id, seq, localId: null, createdAt: seq, text };
}

type Props = Readonly<{ messages: readonly Message[]; query: string }>;

async function renderFind(initial: Props) {
    const jumped: string[] = [];
    const jumpToMatch = vi.fn((match: TranscriptFindMatch) => { jumped.push(match.messageId); });
    const hook = await renderHook((props: Props) => useTranscriptFind({
        messageIdsOldestFirst: props.messages.map((message) => message.id),
        messagesById: Object.fromEntries(props.messages.map((message) => [message.id, message])),
        query: props.query,
        jumpToMatch,
    }), { initialProps: initial });
    return { hook, jumped };
}

const MESSAGES = [
    user('m1', 1, 'deploy the server'),
    user('m2', 2, 'unrelated'),
    user('m3', 3, 'deploy again'),
    user('m4', 4, 'deploy finished'),
];

describe('useTranscriptFind', () => {
    it('jumps to the first match as soon as the query matches', async () => {
        const { hook, jumped } = await renderFind({ messages: MESSAGES, query: '' });
        expect(hook.getCurrent().total).toBe(0);
        expect(jumped).toEqual([]);

        await hook.rerender({ messages: MESSAGES, query: 'deploy' });

        expect(hook.getCurrent()).toMatchObject({ total: 3, activeIndex: 0 });
        expect(jumped).toEqual(['m1']);
    });

    it('steps to older and newer matches and wraps at either end', async () => {
        const { hook, jumped } = await renderFind({ messages: MESSAGES, query: 'deploy' });

        await act(async () => { hook.getCurrent().goNewer(); });
        await act(async () => { hook.getCurrent().goNewer(); });
        expect(hook.getCurrent().activeIndex).toBe(2);
        await act(async () => { hook.getCurrent().goNewer(); });
        expect(hook.getCurrent().activeIndex).toBe(0);
        await act(async () => { hook.getCurrent().goOlder(); });
        expect(hook.getCurrent().activeIndex).toBe(2);

        expect(jumped).toEqual(['m1', 'm3', 'm4', 'm1', 'm4']);
    });

    it('keeps the current match without re-jumping when new messages arrive', async () => {
        const { hook, jumped } = await renderFind({ messages: MESSAGES, query: 'deploy' });
        await act(async () => { hook.getCurrent().goNewer(); });
        expect(jumped).toEqual(['m1', 'm3']);

        await hook.rerender({ messages: [...MESSAGES, user('m5', 5, 'deploy once more')], query: 'deploy' });

        expect(hook.getCurrent()).toMatchObject({ total: 4, activeIndex: 1 });
        expect(jumped).toEqual(['m1', 'm3']);
    });

    it('restarts on the first match once older history has loaded', async () => {
        const recent = MESSAGES.slice(2);
        const { hook, jumped } = await renderFind({ messages: recent, query: 'deploy' });
        await act(async () => { hook.getCurrent().goNewer(); });
        expect(jumped).toEqual(['m3', 'm4']);

        await hook.rerender({ messages: MESSAGES, query: 'deploy' });
        expect(hook.getCurrent()).toMatchObject({ total: 3, activeIndex: 2 });

        await act(async () => { hook.getCurrent().restart(); });

        expect(hook.getCurrent().activeIndex).toBe(0);
        expect(jumped).toEqual(['m3', 'm4', 'm1']);
    });
});
