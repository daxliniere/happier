import { resolveKeyboardPlatform } from '@/keyboard/runtime';
import type { KeyboardPlatform } from '@/keyboard/types';

/** The platform's primary command modifier: Cmd on macOS, Ctrl elsewhere. */
export function isPrimaryModifierHeld(params: Readonly<{
    platform: KeyboardPlatform;
    metaKey: boolean;
    ctrlKey: boolean;
}>): boolean {
    return params.platform === 'macos' ? params.metaKey : params.ctrlKey;
}

/**
 * Reads the primary modifier from a press, click or mouse event. React Native Web exposes the
 * modifiers on `nativeEvent`, DOM events on the event itself; a press without modifiers is false.
 */
export function isPrimaryModifierPressEvent(
    event?: unknown,
    platform: KeyboardPlatform = resolveKeyboardPlatform(),
): boolean {
    const eventRecord = event && typeof event === 'object'
        ? event as Readonly<Record<string, unknown>>
        : null;
    const nativeEvent = eventRecord?.nativeEvent && typeof eventRecord.nativeEvent === 'object'
        ? eventRecord.nativeEvent as Readonly<Record<string, unknown>>
        : null;
    return isPrimaryModifierHeld({
        platform,
        metaKey: eventRecord?.metaKey === true || nativeEvent?.metaKey === true,
        ctrlKey: eventRecord?.ctrlKey === true || nativeEvent?.ctrlKey === true,
    });
}
