import { describe, expect, it } from 'vitest';

import { darkTheme, lightTheme } from '@/theme';
import type { SessionRowAttentionState } from './resolveSessionRowPresentation';
import { isObviousAttentionState, resolveObviousAttentionPalette } from './obviousAttention';

describe('isObviousAttentionState', () => {
    it.each<SessionRowAttentionState>(['permission_required', 'action_required', 'failed'])(
        'breathes for %s, the states that wait on the person',
        (state) => {
            expect(isObviousAttentionState(state)).toBe(true);
        },
    );

    it.each<SessionRowAttentionState>(['quiet', 'unread', 'pending', 'working', 'ready'])(
        'stays still for %s',
        (state) => {
            expect(isObviousAttentionState(state)).toBe(false);
        },
    );
});

describe('resolveObviousAttentionPalette', () => {
    it.each([
        ['light', lightTheme],
        ['dark', darkTheme],
    ] as const)('inverts the row surface and ink in the %s theme', (_name, theme) => {
        const palette = resolveObviousAttentionPalette(theme);

        expect(palette.invertedSurface).toBe(theme.colors.text.primary);
        expect(palette.invertedInk).toBe(theme.colors.surface.base);
        expect(palette.restSurface).toBe(theme.colors.surface.base);
        expect(palette.invertedSurface).not.toBe(palette.restSurface);
    });
});
