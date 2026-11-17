import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { deriveTranscriptInteraction } from '@/utils/sessions/deriveTranscriptInteraction';
import { installMessageViewCommonModuleMocks } from './messageViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerPushSpy = vi.fn();
const statSpy = vi.hoisted(() => vi.fn());

installMessageViewCommonModuleMocks({
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ router: { push: routerPushSpy } }).module;
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock, createUseLocalSettingMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: {
                useSetting: () => null,
                useLocalSetting: createUseLocalSettingMock({ values: { uiMultiPanePanelsEnabled: false } }),
                useSessionForkSupportSource: () => null,
                useSessionWorkspacePath: () => null,
                useSessionMessagesById: () => ({}),
                useSessionMessagesReducerState: () => ({} as any),
            },
        });
    },
});

// The machine RPC is the genuine system boundary here; everything above it is real.
vi.mock('@/sync/ops/sessionFileSystem/pathMetadataMutations', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/sync/ops/sessionFileSystem/pathMetadataMutations')>()),
    sessionStatFile: statSpy,
}));

vi.mock('@/components/markdown/MarkdownView', () => ({
    MarkdownView: (props: any) => React.createElement('MarkdownView', props),
}));
vi.mock('@/components/sessions/transcript/structured/StructuredMessageBlock', () => ({
    StructuredMessageBlock: () => null,
    renderStructuredMessage: () => null,
}));
vi.mock('@/components/tools/shell/views/ToolView', () => ({ ToolView: () => null }));
vi.mock('@/components/tools/shell/views/ToolTimelineRow', () => ({ ToolTimelineRow: () => null }));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({ useFeatureEnabled: () => false }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));

async function renderAgentLink(markdown: string) {
    const { MessageView } = await import('./MessageView');
    const { AppPaneProvider } = await import('@/components/appShell/panes/AppPaneProvider');
    return renderScreen(
        <AppPaneProvider>
            <MessageView
                sessionId="s1"
                metadata={null}
                interaction={deriveTranscriptInteraction({ kind: 'session', canOpenFiles: true } as any)}
                message={{ kind: 'agent-text', id: 'a1', localId: 'local-a1', createdAt: 1, text: markdown } as any}
            />
        </AppPaneProvider>,
    );
}

describe('MessageView folder links', () => {
    beforeEach(() => {
        routerPushSpy.mockClear();
        statSpy.mockReset();
    });

    afterEach(() => {
        standardCleanup();
    });

    it('opens the file browser, not the file viewer, when a link points at a folder', async () => {
        statSpy.mockResolvedValue({ success: true, exists: true, kind: 'directory' });
        const screen = await renderAgentLink('[builds](builds/final)');

        expect(screen.findByType('MarkdownView').props.onLinkPress('builds/final')).toBe(true);
        await vi.waitFor(() => expect(routerPushSpy).toHaveBeenCalledTimes(1));

        expect(statSpy).toHaveBeenCalledWith('s1', 'builds/final');
        expect(routerPushSpy).toHaveBeenCalledWith('/session/s1/files');
    });

    it('still opens a file link in the file viewer', async () => {
        statSpy.mockResolvedValue({ success: true, exists: true, kind: 'file' });
        const screen = await renderAgentLink('[notes](docs/notes.md)');

        expect(screen.findByType('MarkdownView').props.onLinkPress('docs/notes.md')).toBe(true);
        await vi.waitFor(() => expect(routerPushSpy).toHaveBeenCalledTimes(1));

        expect(routerPushSpy).toHaveBeenCalledWith('/session/s1/file?path=docs%2Fnotes.md');
    });

    it('falls back to the file viewer when the path cannot be inspected', async () => {
        statSpy.mockResolvedValue({ success: false, error: 'offline' });
        const screen = await renderAgentLink('[notes](docs/notes.md)');

        expect(screen.findByType('MarkdownView').props.onLinkPress('docs/notes.md')).toBe(true);
        await vi.waitFor(() => expect(routerPushSpy).toHaveBeenCalledTimes(1));

        expect(routerPushSpy).toHaveBeenCalledWith('/session/s1/file?path=docs%2Fnotes.md');
    });
});
