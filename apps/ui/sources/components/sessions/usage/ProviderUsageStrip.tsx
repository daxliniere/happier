import * as React from 'react';
import { Pressable, View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

import { AgentIcon } from '@/agents/registry/AgentIcon';
import { useEnabledAgentIds } from '@/agents/hooks/useEnabledAgentIds';
import { AgentInputContentPopover } from '@/components/sessions/agentInput/components/AgentInputContentPopover';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { useProviderUsageAutoRefresh } from '@/hooks/server/connectedServices/useProviderUsageAutoRefresh';
import { useProfile, useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { ProviderUsageDetails } from './ProviderUsageDetails';
import { ProviderUsageRing } from './ProviderUsageRing';
import { resolveProviderUsageGaugeWindowMode } from './resolveProviderUsageGaugeWindowMode';
import { useProviderUsageGauges } from './useProviderUsageGauges';

const STRIP_ICON_SIZE = 12;

/**
 * Remaining usage for every configured provider (one with a connected profile or a recorded native
 * login), pinned at the top of the sessions pane. Tapping a provider's rings opens the same usage
 * details for all providers in one panel and refreshes all providers. A configured provider whose figures
 * are unavailable keeps an empty grey ring; only unconfigured providers are left out.
 */
export const ProviderUsageStrip = React.memo(function ProviderUsageStrip() {
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
    return <ProviderUsageStripContent agentIds={shownAgentIds} gauges={gauges} onRefresh={refreshAgent} />;
});

/** The strip's presentation; quota subscriptions stay at its connected owner above. */
export function ProviderUsageStripContent({ agentIds, gauges, onRefresh }: Readonly<{
    agentIds: readonly AgentId[];
    gauges: ReadonlyMap<AgentId, ConnectedServiceQuotaGaugeViewModel>;
    onRefresh: (agentId: AgentId) => void;
}>) {
    const styles = stylesheet;
    const anchorRef = React.useRef<React.ElementRef<typeof View>>(null);
    const [open, setOpen] = React.useState(false);
    if (agentIds.length === 0) return null;
    return (
        <>
            <View ref={anchorRef} collapsable={false} testID="sessions-provider-usage-strip" style={styles.strip} accessibilityLabel={t('agentInput.providerUsage.title')}>
                {agentIds.map((agentId) => (
                    <Pressable
                        key={agentId}
                        testID={`sessions-provider-usage-trigger:${agentId}`}
                        style={styles.item}
                        accessibilityRole="button"
                        accessibilityLabel={t('agentInput.providerUsage.titleForProvider', { provider: t(getAgentCore(agentId).displayNameKey) })}
                        accessibilityState={{ expanded: open }}
                        onPress={() => {
                            onRefresh(agentId);
                            setOpen((previous) => !previous);
                        }}
                    >
                        <AgentIcon agentId={agentId} size={STRIP_ICON_SIZE} />
                        <ProviderUsageRing gauge={gauges.get(agentId) ?? null} testID={`sessions-provider-usage:${agentId}`} />
                    </Pressable>
                ))}
            </View>
            <AgentInputContentPopover
                open={open}
                anchorRef={anchorRef}
                placement="bottom"
                onRequestClose={() => setOpen(false)}
                maxWidthCap={420}
                testID="sessions-provider-usage-popover"
                content={open ? (
                    <View testID="sessions-provider-usage-sections">
                        {agentIds.map((agentId) => {
                            const gauge = gauges.get(agentId);
                            return (
                                <View key={agentId} testID={`sessions-provider-usage-section:${agentId}`} style={styles.section}>
                                    {gauge ? (
                                        <ProviderUsageDetails viewModel={gauge} leading={(
                                            <>
                                                <AgentIcon agentId={agentId} size={STRIP_ICON_SIZE} />
                                                <ProviderUsageRing gauge={gauge} />
                                            </>
                                        )} />
                                    ) : (
                                        <View style={styles.unavailable}>
                                            <View style={styles.item}>
                                                <AgentIcon agentId={agentId} size={STRIP_ICON_SIZE} />
                                                <ProviderUsageRing gauge={null} />
                                                <Text style={styles.providerName}>{t(getAgentCore(agentId).displayNameKey)}</Text>
                                            </View>
                                            <Text style={styles.unavailableLabel}>{t('common.unavailable')}</Text>
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                ) : null}
            />
        </>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
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
        minHeight: 48,
        minWidth: 48,
    },
    section: {
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border.subtle,
    },
    unavailable: {
        paddingHorizontal: 18,
        paddingVertical: 16,
        gap: 8,
    },
    providerName: {
        ...Typography.header(),
        color: theme.colors.text.primary,
    },
    unavailableLabel: {
        ...Typography.default(),
        color: theme.colors.text.secondary,
    },
}));
