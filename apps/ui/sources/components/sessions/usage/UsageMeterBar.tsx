import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { MeterBar, type MeterBarProps } from '@/components/ui/lists/MeterBar';
import { resolveCapacityColor } from '@/components/ui/progress/capacityColor';
import { useSetting } from '@/sync/domains/state/storage';
import { resolveRemainingUsageColor } from './tokenUsageTone';

/** Usage bars share the rings' remaining-capacity palette, including its ink treatment. */
export function UsageMeterBar(props: Omit<MeterBarProps, 'fillColor'> & Readonly<{ remainingPct: number | null }>) {
    const { theme } = useUnistyles();
    const coloredUsageRings = useSetting('coloredUsageRings');
    const { remainingPct, ...barProps } = props;
    const fillColor = remainingPct !== null && coloredUsageRings
        ? resolveCapacityColor(resolveRemainingUsageColor({
            remainingPct,
            fullColor: theme.colors.state.success.foreground,
            midColor: theme.colors.state.warning.foreground,
            emptyColor: theme.colors.state.danger.foreground,
        }))
        : undefined;
    return <MeterBar {...barProps} fillColor={fillColor} />;
}
