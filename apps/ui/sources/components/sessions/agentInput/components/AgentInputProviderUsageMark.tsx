import * as React from 'react';
import { View } from 'react-native';

import { ProviderUsageRing } from '@/components/sessions/usage/ProviderUsageRing';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import type { AgentInputChipPickerOption } from './AgentInputChipPickerTypes';

/** The provider reading stays visible while the surrounding row owns selection. */
export function AgentInputProviderUsageMark(props: Readonly<{
    option: AgentInputChipPickerOption;
    gaugesByOptionId: ReadonlyMap<string, ConnectedServiceQuotaGaugeViewModel>;
}>) {
    return (
        <View pointerEvents="none">
            <ProviderUsageRing
                gauge={props.gaugesByOptionId.get(props.option.id) ?? null}
                testID={`agent-input-chip-picker.usage:${props.option.id}`}
            />
        </View>
    );
}
