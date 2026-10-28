import * as React from 'react';
import { useUnistyles } from 'react-native-unistyles';

import { CapacityRing } from '@/components/ui/progress/CapacityRing';
import { TokenUsageRing } from '@/components/sessions/usage';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { t } from '@/text';

const RAIL_RING_SIZE = 18;

/**
 * One Agent row's usage ring in the picker rail. A row without a gauge (Agent not
 * installed, not configured, or with no usage source) shows an empty, light-grey
 * ring with no number, so it reads as "nothing to show" rather than a selection control.
 */
export function AgentPickerUsageRing(props: Readonly<{
    gauge: ConnectedServiceQuotaGaugeViewModel | null;
    testID?: string;
}>) {
    const { theme } = useUnistyles();
    if (!props.gauge) {
        return (
            <CapacityRing
                ratio={0}
                size={RAIL_RING_SIZE}
                strokeWidth={2}
                trackColor={theme.colors.border.subtle}
                testID={props.testID}
            />
        );
    }
    const ring = props.gauge.usageRings[0];
    const usedPct = ring?.usedPct ?? props.gauge.usedPct;
    return (
        <TokenUsageRing
            used={usedPct}
            limit={100}
            label={t('agentInput.providerUsage.accessibilityLabel', { value: props.gauge.badgeLabel })}
            value={ring?.ringValueLabel ?? props.gauge.ringValueLabel}
            tone="neutral"
            remainingPct={100 - usedPct}
            size={RAIL_RING_SIZE}
            testID={props.testID}
        />
    );
}
