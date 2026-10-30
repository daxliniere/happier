import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AgentIcon } from '@/agents/registry/AgentIcon';
import { useEnabledAgentIds } from '@/agents/hooks/useEnabledAgentIds';
import { useProfile, useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { ProviderUsageRing } from './ProviderUsageRing';
import { resolveProviderUsageGaugeWindowMode } from './resolveProviderUsageGaugeWindowMode';
import { useProviderUsageGauges } from './useProviderUsageGauges';

const STRIP_ICON_SIZE = 12;

/**
 * Remaining usage for every configured provider, pinned at the top of the sessions pane.
 * A provider with no usage data is left out rather than drawn empty, so the strip only
 * ever shows real readings (an exhausted provider still shows, as an empty 0 ring).
 */
export const ProviderUsageStrip = React.memo(function ProviderUsageStrip() {
    const styles = stylesheet;
    const agentIds = useEnabledAgentIds();
    const accountProfile = useProfile();
    const windowMode = resolveProviderUsageGaugeWindowMode(useSetting('sessionProviderUsageGaugeWindowMode'));
    const { gauges, refreshAgent } = useProviderUsageGauges({
        agentIds,
        accountProfileConnectedServicesV2: accountProfile?.connectedServicesV2 ?? [],
        windowMode,
        fetchEnabled: true,
    });
    if (gauges.size === 0) return null;
    return (
        <View testID="sessions-provider-usage-strip" style={styles.strip} accessibilityLabel={t('agentInput.providerUsage.title')}>
            {[...gauges].map(([agentId, gauge]) => (
                <Pressable
                    key={agentId}
                    accessibilityRole="button"
                    accessibilityLabel={t('agentInput.providerUsage.accessibilityLabel', { value: gauge.badgeLabel })}
                    onPress={() => refreshAgent(agentId)}
                    style={styles.item}
                >
                    <AgentIcon agentId={agentId} size={STRIP_ICON_SIZE} />
                    <ProviderUsageRing gauge={gauge} testID={`sessions-provider-usage:${agentId}`} />
                </Pressable>
            ))}
        </View>
    );
});

const stylesheet = StyleSheet.create(() => ({
    strip: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
}));
