import * as React from 'react';
import { MeterBar, type MeterBarProps } from '@/components/ui/lists/MeterBar';
import { resolveCapacityColor } from '@/components/ui/progress/capacityColor';
import { useRemainingUsageColor, useUsageLimitTextColor } from './useRemainingUsageColor';

/**
 * Usage bars share the rings' remaining-capacity palette, including its ink treatment. An exhausted
 * limit's caption turns red.
 */
export function UsageMeterBar(props: Omit<MeterBarProps, 'fillColor' | 'captionColor'> & Readonly<{ remainingPct: number | null }>) {
    const { remainingPct, ...barProps } = props;
    const remainingColor = useRemainingUsageColor()(remainingPct);
    const fillColor = remainingColor ? resolveCapacityColor(remainingColor) : undefined;
    const captionColor = useUsageLimitTextColor(remainingPct);
    return <MeterBar {...barProps} fillColor={fillColor} captionColor={captionColor} />;
}
