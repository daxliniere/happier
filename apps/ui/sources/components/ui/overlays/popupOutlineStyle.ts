/**
 * The single source for the outline every popup draws against the content behind it.
 * FloatingOverlay applies it to all floating popups; popups that draw their own box
 * (for example the transcript Find bar) must spread this rather than copy the values.
 */
export function popupOutlineStyle(theme: Readonly<{ colors: Readonly<{ border: Readonly<{ strong: string }> }> }>) {
    return {
        borderWidth: 2,
        borderColor: theme.colors.border.strong,
    } as const;
}
