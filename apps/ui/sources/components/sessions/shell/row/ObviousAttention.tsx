import React from 'react';
import { StyleSheet, type TextProps } from 'react-native';
import Animated, {
    Easing,
    cancelAnimation,
    interpolateColor,
    makeMutable,
    useAnimatedStyle,
    withRepeat,
    withTiming,
    type SharedValue,
} from 'react-native-reanimated';
import { useUnistyles } from 'react-native-unistyles';

import { Text } from '@/components/ui/text/Text';
import { useIsHostVisible } from '@/hooks/ui/useIsHostVisible';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { OBVIOUS_ATTENTION_BREATH_MS, resolveObviousAttentionPalette } from './obviousAttention';

const AnimatedText = Animated.createAnimatedComponent(Text);

const styles = StyleSheet.create({
    surface: {
        ...StyleSheet.absoluteFillObject,
    },
});

/**
 * One breath for the whole list. Every breathing row reads this single shared value, so the rows
 * inhale together, there is one UI-thread animation however many rows qualify, and nothing runs
 * once the last one unmounts (`apps/ui/AGENTS.md`: every loop declares its stop condition).
 */
const breath = makeMutable(0);
/** Reduced motion keeps the row inverted but still: the state stays visible, only the motion goes. */
const stillInverted = makeMutable(1);
let breathingRowCount = 0;

function acquireBreath(): () => void {
    breathingRowCount += 1;
    if (breathingRowCount === 1) {
        breath.value = withRepeat(
            withTiming(1, { duration: OBVIOUS_ATTENTION_BREATH_MS / 2, easing: Easing.inOut(Easing.quad) }),
            -1,
            true,
        );
    }
    return () => {
        breathingRowCount -= 1;
        if (breathingRowCount === 0) {
            cancelAnimation(breath);
            breath.value = 0;
        }
    };
}

/**
 * Which progress a breathing row follows, and whether it holds the shared breath open.
 * `animationEnabled` is the row's own gate (offscreen rows do not drive it).
 */
function useBreathProgress(animationEnabled: boolean, holdsBreath: boolean): SharedValue<number> {
    const hostVisible = useIsHostVisible();
    const reducedMotion = useReducedMotionPreference();
    const animate = animationEnabled && hostVisible && !reducedMotion;

    React.useEffect(() => {
        if (!animate || !holdsBreath) return;
        return acquireBreath();
    }, [animate, holdsBreath]);

    return reducedMotion ? stillInverted : breath;
}

/** The inverted surface, fading in and out over the row. Sits behind the row's content. */
export const ObviousAttentionSurface = React.memo(function ObviousAttentionSurface(props: Readonly<{
    testID?: string;
    animationEnabled: boolean;
}>) {
    const { theme } = useUnistyles();
    const palette = resolveObviousAttentionPalette(theme);
    const progress = useBreathProgress(props.animationEnabled, true);
    const animatedStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

    return (
        <Animated.View
            testID={props.testID}
            pointerEvents="none"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            style={[styles.surface, { backgroundColor: palette.invertedSurface }, animatedStyle]}
        />
    );
});

/**
 * A row's text ink crossing from its resting colour to the inverted ink in step with the surface, so
 * the text is readable at every point of the breath. Used in place of `Text` only while the row
 * breathes; the swap remounts a stateless text leaf, and only when the row's attention state flips.
 */
export const ObviousAttentionText = React.memo(function ObviousAttentionText(props: TextProps & Readonly<{
    restColor: string;
    animationEnabled: boolean;
}>) {
    const { restColor, animationEnabled, style, ...textProps } = props;
    const { theme } = useUnistyles();
    const { invertedInk } = resolveObviousAttentionPalette(theme);
    const progress = useBreathProgress(animationEnabled, false);
    const animatedStyle = useAnimatedStyle(() => ({
        color: interpolateColor(progress.value, [0, 1], [restColor, invertedInk]),
    }));

    return <AnimatedText {...textProps} style={[style, animatedStyle]} />;
});
