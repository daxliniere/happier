// @vitest-environment jsdom
import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionFixture, renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';
import { SessionDocumentTitle } from './SessionDocumentTitle';

const route = vi.hoisted(() => ({
    segments: ['(app)', 'index'],
    params: {} as Record<string, string>,
}));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({
        segments: () => route.segments,
        params: () => route.params,
    }).module;
});

const initialState = storage.getState();
afterEach(() => {
    standardCleanup();
    storage.setState(initialState, true);
});

it('tracks the active session name as it loads, changes, and leaves the foreground route', async () => {
    document.title = 'Happier (preview)';
    route.segments = ['(app)', 'session', '[id]'];
    route.params = { id: 'alpha', serverId: 'server-a' };
    storage.setState({ sessions: {} });
    const screen = await renderScreen(<SessionDocumentTitle enabled />);
    expect(document.title).toBe('Happier (preview)');

    const metadata = { path: '/project', host: 'host', machineId: 'machine', name: 'Alpha' };
    const alpha = { ...createSessionFixture({ id: 'alpha', metadata }), serverId: 'server-a' };
    const beta = createSessionFixture({ id: 'beta', metadata: { ...metadata, name: 'Beta' } });
    await React.act(async () => storage.setState({ sessions: { alpha, beta } }));
    expect(document.title).toBe('Happier - Alpha');

    const renamedAlpha = { ...alpha, metadata: { ...metadata, summary: { text: 'Renamed Alpha', updatedAt: 1 } } };
    await React.act(async () => storage.setState({ sessions: { alpha: renamedAlpha, beta } }));
    expect(document.title).toBe('Happier - Renamed Alpha');

    route.params = { id: 'alpha', serverId: 'server-b' };
    await screen.update(<SessionDocumentTitle enabled />);
    expect(document.title).toBe('Happier (preview)');

    route.segments = ['(app)', 'session', '[id]', 'info'];
    route.params = { id: 'beta' };
    await screen.update(<SessionDocumentTitle enabled />);
    expect(document.title).toBe('Happier - Beta');

    route.segments = ['(app)', 'settings', 'index'];
    await screen.update(<SessionDocumentTitle enabled />);
    expect(document.title).toBe('Happier (preview)');

    route.segments = ['(app)', 'session', '[id]'];
    await screen.update(<SessionDocumentTitle enabled />);
    expect(document.title).toBe('Happier - Beta');
    await screen.update(<SessionDocumentTitle enabled={false} />);
    expect(document.title).toBe('Happier (preview)');
});
