import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import type {
    AccessibilityRole,
    AccessibilityState,
    GestureResponderEvent,
    PressableProps,
    PressableStateCallbackType,
    StyleProp,
    ViewStyle,
} from 'react-native';

import { FocusRing, WEB_FOCUS_OUTLINE_RESET, type FocusRingPlacement } from '@/components/ui/interaction/FocusRing';
import { useIsKeyboardModality } from '@/components/ui/interaction/inputModalityStore';
import { usePressFeedback, type PressFeedbackTone } from '@/components/ui/interaction/usePressFeedback';

import { DeferredAnchoredTooltip } from '@/components/ui/overlays/DeferredAnchoredTooltip';

/**
 * A `Pressable` that already knows the two things every pressable in this app kept getting wrong:
 * press feedback tints the surface instead of dimming the content, and keyboard focus is visible
 * while touch focus is not.
 *
 * It owns no box of its own — no size, no radius, no chrome. `IconAction` and `ToolbarButton` keep
 * their own geometry and hand it in, which is why adopting this changed neither of them visually.
 */

export type PressableSurfaceProps = Readonly<{
    children?: React.ReactNode;
    onPress?: (event: GestureResponderEvent) => void;
    onLongPress?: (event: GestureResponderEvent) => void;
    onPressIn?: PressableProps['onPressIn'];
    focusable?: PressableProps['focusable'];
    pointerEvents?: PressableProps['pointerEvents'];
    accessibilityElementsHidden?: PressableProps['accessibilityElementsHidden'];
    importantForAccessibility?: PressableProps['importantForAccessibility'];
    disabled?: boolean;
    /** Renders the resting fill as if hovered — a control that is toggled on. */
    active?: boolean;
    tone?: PressFeedbackTone;
    hitSlop?: PressableProps['hitSlop'];
    accessibilityRole?: AccessibilityRole;
    accessibilityLabel?: string;
    accessibilityHint?: string;
    accessibilityState?: AccessibilityState;
    /** Corner radius the focus ring traces. Keep it equal to the box's own radius. */
    focusRingRadius?: number;
    focusRingPlacement?: FocusRingPlacement;
    /** Inset the feedback paint and focus ring inside the interactive frame. */
    feedbackInset?: number;
    /** The control's own box styling. The feedback fill is applied ON TOP of it. */
    style?: PressableProps['style'];
    /**
     * Applied LAST, after the feedback fill, so a consumer's `style` prop still has the final word
     * — which is the ordering the adopting controls already had.
     */
    styleOverride?: StyleProp<ViewStyle>;
    /** Portaled hover/keyboard-focus tooltip on web; a no-op elsewhere. */
    webTooltip?: string;
    onHoverIn?: PressableProps['onHoverIn'];
    onHoverOut?: PressableProps['onHoverOut'];
    tooltipContent?: React.ReactNode;
    tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right';
    testID?: string;
}>;

export const PressableSurface = React.memo((props: PressableSurfaceProps) => {
    const disabled = props.disabled ?? false;
    const feedback = usePressFeedback({
        tone: props.tone ?? 'control',
        disabled,
        selected: props.active,
    });

    const keyboardModality = useIsKeyboardModality();
    const [focused, setFocused] = React.useState(false);
    const [hoveredForTooltip, setHovered] = React.useState(false);
    const anchorRef = React.useRef<View | null>(null);
    const ringVisible = focused && keyboardModality && !disabled;
    // `FocusRing` runs a Reanimated animated style, so an always-mounted one would cost a shared
    // value per control on every surface in the app for a ring that native can never show (RN
    // reports no keypress, so the modality never leaves `pointer` there). `focused` keeps it
    // mounted while it fades out after the user drops back to the pointer.
    const ringMounted = keyboardModality || focused;
    const feedbackInset = props.feedbackInset ?? 0;

    const handleFocus = React.useCallback(() => setFocused(true), []);
    const handleBlur = React.useCallback(() => setFocused(false), []);
    const handleHoverIn = React.useCallback((event: Parameters<NonNullable<PressableProps['onHoverIn']>>[0]) => {
        setHovered(true);
        props.onHoverIn?.(event);
    }, [props.onHoverIn]);
    const handleHoverOut = React.useCallback((event: Parameters<NonNullable<PressableProps['onHoverOut']>>[0]) => {
        setHovered(false);
        props.onHoverOut?.(event);
    }, [props.onHoverOut]);

    const resolveStyle = React.useCallback((state: PressableStateCallbackType & { hovered?: boolean }) => {
        const { pressed, hovered } = state;
        const consumerStyle = typeof props.style === 'function' ? props.style(state) : props.style;
        const backgroundColor = feedbackInset > 0 ? undefined : feedback.resolveBackgroundColor({ pressed, hovered });
        return [
            consumerStyle,
            Platform.OS === 'web' ? WEB_FOCUS_OUTLINE_RESET : null,
            backgroundColor === undefined ? null : { backgroundColor },
            props.styleOverride,
        ];
    }, [feedback, feedbackInset, props.style, props.styleOverride]);

    const renderContent = ({ pressed, hovered }: { pressed?: boolean; hovered?: boolean }) => (
        <>
            {feedbackInset > 0 ? (
                <View
                    testID={props.testID ? `${props.testID}-feedback-surface` : undefined}
                    pointerEvents="none"
                    style={{
                        position: 'absolute',
                        top: feedbackInset,
                        right: feedbackInset,
                        bottom: feedbackInset,
                        left: feedbackInset,
                        borderRadius: props.focusRingRadius,
                        backgroundColor: feedback.resolveBackgroundColor({ pressed, hovered }),
                    }}
                >
                    {ringMounted ? (
                        <FocusRing
                            testID={props.testID === undefined ? undefined : `${props.testID}-focus-ring`}
                            visible={ringVisible}
                            radius={props.focusRingRadius}
                            placement={props.focusRingPlacement}
                        />
                    ) : null}
                </View>
            ) : null}
            {props.children}
            {Platform.OS === 'web' && props.webTooltip && (hoveredForTooltip || ringVisible) ? (
                <DeferredAnchoredTooltip activationKey={`${hoveredForTooltip}:${focused}`} anchorRef={anchorRef} label={props.webTooltip} content={props.tooltipContent} placement={props.tooltipPlacement} testID={props.testID ? `${props.testID}-tooltip` : undefined} />
            ) : null}
            {feedbackInset === 0 && ringMounted ? (
                <FocusRing
                    testID={props.testID === undefined ? undefined : `${props.testID}-focus-ring`}
                    visible={ringVisible}
                    radius={props.focusRingRadius}
                    placement={props.focusRingPlacement}
                />
            ) : null}
        </>
    );

    return (
        <Pressable
            ref={anchorRef}
            testID={props.testID}
            onPress={disabled ? undefined : props.onPress}
            onLongPress={disabled ? undefined : props.onLongPress}
            onPressIn={disabled ? undefined : props.onPressIn}
            focusable={props.focusable}
            pointerEvents={props.pointerEvents}
            accessibilityElementsHidden={props.accessibilityElementsHidden}
            importantForAccessibility={props.importantForAccessibility}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onHoverIn={props.webTooltip ? handleHoverIn : undefined}
            onHoverOut={props.webTooltip ? handleHoverOut : undefined}
            hitSlop={props.hitSlop}
            disabled={disabled}
            accessibilityRole={props.accessibilityRole ?? 'button'}
            accessibilityLabel={props.accessibilityLabel}
            accessibilityHint={props.accessibilityHint}
            accessibilityState={{ ...props.accessibilityState, disabled }}
            aria-checked={props.accessibilityState?.checked}
            aria-expanded={props.accessibilityState?.expanded}
            aria-selected={props.accessibilityState?.selected}
            aria-busy={props.accessibilityState?.busy}
            {...(Platform.OS === 'web' && (props.accessibilityRole === 'switch' || props.accessibilityRole === 'checkbox') ? {
                // RN Web activates Space only for button roles; checkable controls need the same key contract.
                onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                    if (event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                },
                onKeyUp: (event: React.KeyboardEvent<HTMLElement>) => {
                    if (event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (!disabled) event.currentTarget.click();
                },
            } : null)}
            style={resolveStyle}
        >
            {feedbackInset > 0 ? renderContent : renderContent({})}
        </Pressable>
    );
});

PressableSurface.displayName = 'PressableSurface';
