import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { AgentIcon } from '@/agents/registry/AgentIcon';
import { useEnabledAgentIds } from '@/agents/hooks/useEnabledAgentIds';
import { AgentInputProviderUsageBadge } from '@/components/sessions/agentInput/components/AgentInputProviderUsageBadge';
import { useProviderUsageAutoRefresh } from '@/hooks/server/connectedServices/useProviderUsageAutoRefresh';
import { useProfile, useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { ProviderUsageRing } from './ProviderUsageRing';
import { resolveProviderUsageGaugeWindowMode } from './resolveProviderUsageGaugeWindowMode';
import { useProviderUsageGauges } from './useProviderUsageGauges';

const STRIP_ICON_SIZE = 12;

/**
 * Remaining usage for every configured provider (one with a connected profile or a recorded native
 * login), pinned at the top of the sessions pane. Tapping a provider's rings opens the same usage
 * popup as the composer's rings and refreshes all providers. A configured provider whose figures
 * are unavailable keeps an empty grey ring; only unconfigured providers are left out.
 */
export const ProviderUsageStrip = React.memo(function ProviderUsageStrip() {
    const styles = stylesheet;
    const agentIds = useEnabledAgentIds();
    const accountProfile = useProfile();
    const windowMode = resolveProviderUsageGaugeWindowMode(useSetting('sessionProviderUsageGaugeWindowMode'));
    const { gauges, configuredAgentIds, refreshAgent } = useProviderUsageGauges({
        agentIds,
        accountProfileConnectedServicesV2: accountProfile?.connectedServicesV2 ?? [],
        windowMode,
        fetchEnabled: true,
    });
    useProviderUsageAutoRefresh();
    const shownAgentIds = agentIds.filter((agentId) => gauges.has(agentId) || configuredAgentIds.has(agentId));
    if (shownAgentIds.length === 0) return null;
    return (
        <View testID="sessions-provider-usage-strip" style={styles.strip} accessibilityLabel={t('agentInput.providerUsage.title')}>
            {shownAgentIds.map((agentId) => {
                const gauge = gauges.get(agentId);
                return (
                    <View key={agentId} style={styles.item}>
                        <AgentIcon agentId={agentId} size={STRIP_ICON_SIZE} />
                        {gauge ? (
                            <AgentInputProviderUsageBadge viewModel={gauge} onRefresh={() => refreshAgent(agentId)} />
                        ) : (
                            <Pressable accessibilityRole="button" onPress={() => refreshAgent(agentId)}>
                                <ProviderUsageRing gauge={null} testID={`sessions-provider-usage:${agentId}`} />
                            </Pressable>
                        )}
                    </View>
                );
            })}
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
