// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

import { installMarkdownCommonModuleMocks } from './markdownTestHelpers';

const { setStringAsync } = vi.hoisted(() => ({ setStringAsync: vi.fn<(value: string) => Promise<boolean>>() }));
vi.mock('expo-clipboard', () => ({ setStringAsync }));

vi.mock('react-native-enriched-markdown', () => ({
    EnrichedMarkdownText: () => (
        <>
            <p>Run <code>git diff -- apps/ui</code> in the checkout.</p>
            <pre><code>git status</code></pre>
        </>
    ),
}));

installMarkdownCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        const { View, Text } = await import('react-native-web');
        return createReactNativeWebMock({ View, Text });
    },
});

it('copies the whole inline code span on a double click and confirms a successful write', async () => {
    const { MarkdownView } = await import('./MarkdownView');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const toast = () => container.querySelector('[data-testid="markdown-inline-code-copied"]');
    const click = async (selector: string, type: string) => {
        const target = container.querySelector(selector);
        expect(target).not.toBeNull();
        await act(async () => {
            target?.dispatchEvent(new MouseEvent(type, { bubbles: true }));
        });
    };

    try {
        await act(async () => root.render(<MarkdownView markdown={'Run `git diff -- apps/ui` in the checkout.'} />));
        await click('p > code', 'click');
        await click('p', 'dblclick');
        await click('pre > code', 'dblclick');
        expect(setStringAsync).not.toHaveBeenCalled();

        setStringAsync.mockResolvedValueOnce(false);
        await click('p > code', 'dblclick');
        expect(setStringAsync).toHaveBeenCalledWith('git diff -- apps/ui');
        expect(toast()).toBeNull();

        setStringAsync.mockResolvedValueOnce(true);
        await click('p > code', 'dblclick');
        expect(setStringAsync).toHaveBeenCalledTimes(2);
        expect(toast()?.textContent).toBe('Copied!');
    } finally {
        await act(async () => root.unmount());
        container.remove();
    }
});
