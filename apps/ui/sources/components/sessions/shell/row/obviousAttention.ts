import type { Theme } from '@/theme';
import type { SessionRowAttentionState } from './resolveSessionRowPresentation';

/**
 * Obvious attention-required mode: the rows that are waiting on the person breathe between their
 * normal colours and the inverted pair. It is a presentation of the row's existing attention state,
 * so the states that qualify are decided here against that state rather than re-derived from the
 * session.
 */
export function isObviousAttentionState(attentionState: SessionRowAttentionState): boolean {
    return attentionState === 'permission_required'
        || attentionState === 'action_required'
        || attentionState === 'failed';
}

/** One full inhale + exhale. Slow enough to read as breathing rather than flashing. */
export const OBVIOUS_ATTENTION_BREATH_MS = 2400;

export type ObviousAttentionPalette = Readonly<{
    restSurface: string;
    invertedSurface: string;
    invertedInk: string;
}>;

/** Inverted = the row's surface and primary ink swapped, so it holds in every light/dark theme. */
export function resolveObviousAttentionPalette(theme: Theme): ObviousAttentionPalette {
    return {
        restSurface: theme.colors.surface.base,
        invertedSurface: theme.colors.text.primary,
        invertedInk: theme.colors.surface.base,
    };
}
