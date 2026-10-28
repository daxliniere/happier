import * as React from 'react';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';

import { Typography } from '@/constants/Typography';
import { Text } from '@/components/ui/text/Text';
import { CapacityRing } from '@/components/ui/progress/CapacityRing';

import { resolveTokenUsageProgressRatio } from './tokenUsageFormatting';
import { useSetting } from '@/sync/domains/state/storage';
import { resolveRemainingUsageColor, resolveTokenUsageToneColor, type TokenUsageTone } from './tokenUsageTone';

export type TokenUsageRingProps = Readonly<{
    used: number;
    limit: number | null | undefined;
    label: string;
    value: string;
    tone?: TokenUsageTone;
    /** When set (and the coloured-rings setting is on) the ring colour follows this remaining %, overriding `tone`. */
    remainingPct?: number;
    size?: number;
    strokeWidth?: number;
    testID?: string;
    ringTestID?: string;
    valueTestID?: string;
    progressTestID?: string;
}>;

/**
 * Token-budget usage ring. A thin, token-domain wrapper over the shared
 * {@link CapacityRing}: it owns the token tone→color mapping and the centered
 * `used / limit` label, and delegates all ring geometry to the canonical
 * primitive so the gauge never drifts from the connected-service capacity rings.
 */
export function TokenUsageRing(props: TokenUsageRingProps) {
    const { theme } = useUnistyles();
    const progressRatio = React.useMemo(
        () => resolveTokenUsageProgressRatio({ used: props.used, limit: props.limit }),
        [props.limit, props.used],
    );
    const coloredUsageRings = useSetting('coloredUsageRings');
    const toneColor = React.useMemo(
        () => props.remainingPct !== undefined && coloredUsageRings
            ? resolveRemainingUsageColor({
                remainingPct: props.remainingPct,
                fullColor: theme.colors.state.success.foreground,
                midColor: theme.colors.state.warning.foreground,
                emptyColor: theme.colors.state.danger.foreground,
            })
            : resolveTokenUsageToneColor({
            tone: props.tone ?? 'neutral',
            neutralColor: theme.colors.text.secondary,
            warningColor: theme.colors.state.neutral.foreground,
            criticalColor: theme.colors.state.danger.foreground,
        }),
        [
            coloredUsageRings,
            props.remainingPct,
            props.tone,
            theme.colors.state.danger.foreground,
            theme.colors.state.neutral.foreground,
            theme.colors.state.success.foreground,
            theme.colors.state.warning.foreground,
            theme.colors.text.secondary,
        ],
    );

    return (
        <CapacityRing
            ratio={progressRatio}
            size={props.size ?? 20}
            strokeWidth={props.strokeWidth ?? 2}
            color={toneColor}
            testID={props.testID}
            ringTestID={props.ringTestID}
            progressTestID={props.progressTestID}
            accessibilityLabel={props.label}
        >
            <Text
                testID={props.valueTestID}
                style={[styles.value, { color: toneColor }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
            >
                {props.value}
            </Text>
        </CapacityRing>
    );
}

const styles = StyleSheet.create(() => ({
    value: {
        fontSize: 8,
        lineHeight: 8,
        textAlign: 'center',
        ...Typography.default(),
    },
}));
