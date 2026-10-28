import { describe, expect, it } from 'vitest';

import { resolveActionOperationContext, resolveActionOperationSessionNameById } from './useActionOperationActivityModel';

describe('resolveActionOperationSessionNameById', () => {
    it('uses a renderable title when the source session is not in the full-session cache', () => {
        const result = resolveActionOperationSessionNameById([], [{
            id: 'session-1',
            metadata: {
                path: '/workspace/remote-dev',
                host: 'workstation',
                summary: { text: 'Stabilize CI and Nightly Releases', updatedAt: 123 },
            },
        }]);

        expect(result.get('session-1')).toBe('Stabilize CI and Nightly Releases');
    });

    it('prefers an explicit renderable title over a full-session path fallback', () => {
        const result = resolveActionOperationSessionNameById(
            [{ id: 'session-1', metadata: { path: '/workspace/remote-dev', host: 'workstation' } }],
            [{
                id: 'session-1',
                metadata: {
                    path: '/workspace/remote-dev',
                    host: 'workstation',
                    summary: { text: 'Canonical session title', updatedAt: 123 },
                },
            }],
        );

        expect(result.get('session-1')).toBe('Canonical session title');
    });
});

describe('resolveActionOperationContext', () => {
    const spawnOperation = {
        version: 1,
        operationId: 'op-1',
        revision: 3,
        actionId: 'session.spawn_new',
        state: 'succeeded',
        scope: { accountId: 'account-1', machineId: 'machine-1' },
        title: 'Create session',
        createdAt: 1,
        startedAt: 2,
        settledAt: 3,
        result: { sessionId: 'session-9' },
        cancellation: 'unsupported',
    } as const;

    it('names the created session together with its machine', () => {
        expect(resolveActionOperationContext(
            spawnOperation,
            new Map([['session-9', 'Fix login bug']]),
            'concierge',
        )).toBe('Fix login bug · concierge');
    });

    it('falls back to the machine when the created session is unknown', () => {
        expect(resolveActionOperationContext(spawnOperation, new Map(), 'concierge')).toBe('concierge');
    });

    it('keeps session-scoped operations labelled by their session alone', () => {
        expect(resolveActionOperationContext(
            { ...spawnOperation, actionId: 'session.fork', scope: { ...spawnOperation.scope, sessionId: 'session-1' } },
            new Map([['session-1', 'Source session']]),
            'concierge',
        )).toBe('Source session');
    });
});
