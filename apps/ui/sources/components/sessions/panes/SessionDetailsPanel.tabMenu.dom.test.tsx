// @vitest-environment jsdom
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createThemeFixture } from '@/dev/testkit/fixtures/themeFixtures';
import { installSessionDetailsPanelCommonModuleMocks } from './sessionDetailsPanelTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installSessionDetailsPanelCommonModuleMocks({
    reactNative: async () => await import('react-native-web'),
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({ theme: createThemeFixture() });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock();
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useLocalSetting: (key: string) => key === 'desktopPathMappingsV1'
                ? [{ remotePath: '/srv/work', localPath: '/mapped' }]
                : key === 'uiFontScale' ? 1 : null,
            useLocalSettingMutable: () => [false, vi.fn()],
            useSessionMachineId: () => 'machine-1',
            useSessionWorkspacePath: () => '/srv/work/app',
            useSessionHomeDir: () => '/home/dax',
        });
    },
});

vi.mock('@/constants/Typography', () => ({
    Typography: new Proxy({}, { get: () => () => ({}) }),
}));

vi.mock('@/components/sessions/terminal/SessionEmbeddedTerminalPane', () => ({
    SessionEmbeddedTerminalPane: () => React.createElement('SessionEmbeddedTerminalPane'),
}));

vi.mock('./SessionDetailsPanelDetailViews', () => ({
    SessionCommitDetailsViewForPanel: (props: any) => React.createElement('SessionCommitDetailsViewForPanel', props),
    SessionFileDetailsViewForPanel: (props: any) => React.createElement('SessionFileDetailsViewForPanel', props),
    SessionScmReviewDetailsViewForPanel: (props: any) => React.createElement('SessionScmReviewDetailsViewForPanel', props),
    SessionScmStashDetailsViewForPanel: (props: any) => React.createElement('SessionScmStashDetailsViewForPanel', props),
    SessionSubagentDetailsViewForPanel: (props: any) => React.createElement('SessionSubagentDetailsViewForPanel', props),
}));

async function renderPanel(root: Root) {
    const { AppPaneProvider } = await import('@/components/appShell/panes/AppPaneProvider');
    const { useAppPaneScope } = await import('@/components/appShell/panes/hooks/useAppPaneScope');
    const { SessionDetailsPanel } = await import('./SessionDetailsPanel');
    function Fixture() {
        const pane = useAppPaneScope('session:s1');
        return (
            <>
                <button data-testid="seed-file-tab" onClick={() => pane.openDetailsTab({
                    key: 'file:docs/notes.md', kind: 'file', title: 'notes.md',
                    resource: { kind: 'file', path: 'docs/notes.md' },
                }, { intent: 'pinned' })}>Open fixture file</button>
                <SessionDetailsPanel sessionId="s1" scopeId="session:s1" />
            </>
        );
    }
    await act(async () => {
        root.render(<AppPaneProvider><Fixture /></AppPaneProvider>);
    });
    await act(async () => {
        document.querySelector('[data-testid="seed-file-tab"]')!.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true }),
        );
    });
}

async function openMenu(label: Element, pointer: 'mouse' | 'touch') {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 });
    await act(async () => {
        if (pointer === 'touch') {
            const touch: Touch = {
                identifier: 1, target: label, pageX: 10, pageY: 10, clientX: 10, clientY: 10,
                screenX: 10, screenY: 10, force: 1, radiusX: 1, radiusY: 1, rotationAngle: 0,
            };
            label.dispatchEvent(new TouchEvent('touchstart', {
                bubbles: true, cancelable: true, touches: [touch], changedTouches: [touch],
            }));
            label.dispatchEvent(event);
            // Cancel before long-press can open the menu independently.
            label.dispatchEvent(new TouchEvent('touchcancel', {
                bubbles: true, cancelable: true, touches: [], changedTouches: [touch],
            }));
        } else {
            label.dispatchEvent(event);
        }
    });
    expect(event.defaultPrevented).toBe(true);
    await act(async () => { await vi.dynamicImportSettled(); });
}

function fileLabel(container: HTMLElement): Element {
    const tab = Array.from(container.querySelectorAll('[role="button"]')).find((node) => node.textContent === 'notes.md');
    expect(tab).toBeDefined();
    const label = Array.from(tab!.querySelectorAll('*')).find((node) =>
        node.childElementCount === 0 && node.textContent === 'notes.md');
    expect(label).toBeDefined();
    return label!;
}

describe('SessionDetailsPanel browser context menu', { timeout: 180_000 }, () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
    });

    it.each(['mouse', 'touch'] as const)('handles the real %s context-menu event on the nested file label', async (pointer) => {
        await renderPanel(root);
        await openMenu(fileLabel(container), pointer);
        expect(document.body.textContent).toContain('session.detailsPanel.tabMenu.openInNewWindow');
    });
    it('shows and invokes all three desktop file actions for a mapped remote file', async () => {
        const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => undefined);
        vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
        await renderPanel(root);
        const actions = [
            ['openWithDefaultApp', 'desktop_open_path_with_default_app'],
            ['revealInFileManager', 'desktop_reveal_path_in_file_manager'],
            ['openInNewWindow', 'desktop_open_file_window'],
        ] as const;
        for (const [action, command] of actions) {
            await openMenu(fileLabel(container), 'mouse');
            for (const [key] of actions) {
                expect(document.body.textContent).toContain('session.detailsPanel.tabMenu.' + key);
            }
            const item = Array.from(document.querySelectorAll('[role="button"],[role="menuitem"]')).find(
                (node) => node.textContent === 'session.detailsPanel.tabMenu.' + action,
            );
            expect(item).toBeDefined();
            await act(async () => {
                item!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            });
            // DropdownMenu defers selection until its close animation has started.
            await act(async () => {
                await vi.waitFor(() => expect(invoke.mock.calls.filter(([name]) => name === command)).toHaveLength(1));
            });
            const calls = invoke.mock.calls.filter(([name]) => name === command);
            expect(calls).toHaveLength(1);
            const call = calls[0];
            if (action === 'openInNewWindow') {
                const args = call![1] as { route: string };
                const url = new URL(args.route, 'http://localhost');
                expect(url.pathname).toBe('/file-window');
                expect(url.searchParams.get('sessionId')).toBe('s1');
                expect(url.searchParams.get('path')).toBe('docs/notes.md');
            } else {
                expect(call![1]).toEqual({ path: '/mapped/app/docs/notes.md' });
            }
        }
    });

});
