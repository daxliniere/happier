import * as React from 'react';
import { MeterBar, type MeterBarProps } from '@/components/ui/lists/MeterBar';
import { resolveCapacityColor } from '@/components/ui/progress/capacityColor';
import { useRemainingUsageColor } from './useRemainingUsageColor';

/** Usage bars share the rings' remaining-capacity palette, including its ink treatment. */
export function UsageMeterBar(props: Omit<MeterBarProps, 'fillColor'> & Readonly<{ remainingPct: number | null }>) {
    const { remainingPct, ...barProps } = props;
    const remainingColor = useRemainingUsageColor()(remainingPct);
    const fillColor = remainingColor ? resolveCapacityColor(remainingColor) : undefined;
    return <MeterBar {...barProps} fillColor={fillColor} />;
}
