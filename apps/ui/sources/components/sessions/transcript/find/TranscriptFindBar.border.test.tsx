import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return await createUnistylesMock();
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: (props: Record<string, unknown>) => React.createElement('Ionicons', props),
}));

vi.mock('@/text', () => ({
    t: (key: string) => key,
}));

vi.mock('@/keyboard/escape', () => ({
    ESCAPE_LAYER_PRIORITIES: { overlay: 0 },
    useEscapeLayer: () => {},
}));

function flattenStyle(style: unknown): Record<string, unknown> {
    if (typeof style === 'function') return flattenStyle(style({ pressed: false, hovered: false, focused: false }));
    if (Array.isArray(style)) return Object.assign({}, ...style.map(flattenStyle));
    return (style && typeof style === 'object') ? style as Record<string, unknown> : {};
}

describe('TranscriptFindBar outline', () => {
    it('uses the shared 2px strong popup border on the find field and expand pill', async () => {
        const { TranscriptFindBar } = await import('./TranscriptFindBar');
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        const strong = ((await createUnistylesMock()).useUnistyles() as any).theme.colors.border.strong;

        const screen = await renderScreen(
            <TranscriptFindBar
                query="abc"
                onChangeQuery={() => {}}
                find={{ activeIndex: null, total: 0, goOlder: () => {}, goNewer: () => {} } as any}
                focusRequest={0}
                onClose={() => {}}
                expand={{ available: true, loading: false, onPress: () => {} }}
            />,
        );

        const container = screen.findByTestId('transcript-find-bar');
        const bar = container?.findAll((node: any) => node.props?.style && flattenStyle(node.props.style).borderRadius === 10)[0];
        const expand = screen.findByTestId('transcript-find-expand');

        for (const node of [bar, expand]) {
            expect(flattenStyle(node?.props.style)).toMatchObject({ borderWidth: 2, borderColor: strong });
        }
    });
});
