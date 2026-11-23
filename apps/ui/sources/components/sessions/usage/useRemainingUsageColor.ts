import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { useSetting } from '@/sync/domains/state/storage';

import { resolveRemainingUsageColor } from './tokenUsageTone';

/**
 * The one colour owner for every usage ring and bar (composer, sessions pane, Agent picker,
 * Settings accounts and pools): green when full, red when empty, following the remaining
 * percentage. Returns null when the coloured-rings setting is off or nothing is known, so the
 * caller keeps its tone colour.
 */
export function useRemainingUsageColor(): (remainingPct: number | null | undefined) => string | null {
    const { theme } = useUnistyles();
    const coloredUsageRings = useSetting('coloredUsageRings');
    const fullColor = theme.colors.state.success.foreground;
    const midColor = theme.colors.state.warning.foreground;
    const emptyColor = theme.colors.state.danger.foreground;
    return React.useCallback((remainingPct: number | null | undefined) => (
        remainingPct === null || remainingPct === undefined || !coloredUsageRings
            ? null
            : resolveRemainingUsageColor({ remainingPct, fullColor, midColor, emptyColor })
    ), [coloredUsageRings, fullColor, midColor, emptyColor]);
}

/** One ring arc for a usage limit: an exhausted limit is drawn as a full ring in its colour. */
export function resolveUsageArc(remainingPct: number | null | undefined, color: string): Readonly<{
    color: string;
    trackColor?: string;
}> {
    return isUsageLimitExhausted(remainingPct)
        ? { color, trackColor: color }
        : { color };
}

/** A usage limit with nothing left. */
export function isUsageLimitExhausted(remainingPct: number | null | undefined): boolean {
    return remainingPct !== null && remainingPct !== undefined && remainingPct <= 0;
}

/**
 * The text colour for a usage limit's name and figures: red once it is exhausted, so a spent limit
 * stands out while its bar keeps showing what is left (nothing). Undefined keeps the usual colour.
 */
export function resolveUsageLimitTextColor(
    theme: Readonly<{ colors: Readonly<{ state: Readonly<{ danger: Readonly<{ foreground: string }> }> }> }>,
    remainingPct: number | null | undefined,
): string | undefined {
    return isUsageLimitExhausted(remainingPct) ? theme.colors.state.danger.foreground : undefined;
}

export function useUsageLimitTextColor(remainingPct: number | null | undefined): string | undefined {
    const { theme } = useUnistyles();
    return resolveUsageLimitTextColor(theme, remainingPct);
}
