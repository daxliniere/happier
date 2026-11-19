import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { lightTheme } from '@/theme';
import { installAgentInputCommonModuleMocks } from '../agentInputTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installAgentInputCommonModuleMocks();

vi.mock('react-native-reanimated', async () =>
    (await import('@/dev/testkit/mocks/reanimated')).createReanimatedModuleMock());

import { AgentInputPopoverSurface } from './AgentInputPopoverSurface';

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    if (style && typeof style === 'object') return style as Record<string, unknown>;
    return {};
}

function Child() {
    return React.createElement('Child');
}

describe('AgentInputPopoverSurface outline', () => {
    // Every composer toolbar popup (attachments/action menu, permission mode, CLI auth, MCP,
    // agent/model pickers...) renders through this surface, so it must carry the same 2px
    // strong-border outline that dropdown menus show.
    it('outlines composer popups with the 2px strong theme border used by menus', async () => {
        const screen = await renderScreen(
            <AgentInputPopoverSurface maxHeight={300}>
                <Child />
            </AgentInputPopoverSurface>,
        );

        const outlined = screen
            .findAllByType('Animated.View' as never)
            .map((node) => flattenStyle(node.props.style))
            .filter((style) => style.borderWidth === 2);

        expect(outlined).toHaveLength(1);
        expect(outlined[0]?.borderColor).toBe(lightTheme.colors.border.strong);
    });
});
