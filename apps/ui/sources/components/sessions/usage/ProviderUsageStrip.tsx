import * as React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { AgentId } from '@/agents/catalog/catalog';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';

import { AgentIcon } from '@/agents/registry/AgentIcon';
import { useEnabledAgentIds } from '@/agents/hooks/useEnabledAgentIds';
import { AgentInputContentPopover } from '@/components/sessions/agentInput/components/AgentInputContentPopover';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import { HorizontalOverflowScrollView } from '@/components/ui/scroll/HorizontalOverflowScrollView';
import { useProviderUsageAutoRefresh } from '@/hooks/server/connectedServices/useProviderUsageAutoRefresh';
import { useProfile, useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { ProviderUsageDetails } from './ProviderUsageDetails';
import { ProviderUsageRing } from './ProviderUsageRing';
import { resolveProviderUsageGaugeWindowMode } from './resolveProviderUsageGaugeWindowMode';
import { useProviderUsageGauges } from './useProviderUsageGauges';

const STRIP_ICON_SIZE = 12;
const PROVIDER_TOUCH_TARGET_SIZE = 48;
const PROVIDER_GAP = 4;

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
    const { accounts, gauges, configuredAgentIds, refreshAgent } = useProviderUsageGauges({
        agentIds,
        accountProfileConnectedServicesV2: accountProfile?.connectedServicesV2 ?? [],
        windowMode,
        fetchEnabled: true,
    });
    useProviderUsageAutoRefresh();
    // Only providers with an account of their own appear; each of their accounts is listed separately.
    const entries = accounts.filter((account) => gauges.has(account.agentId) || configuredAgentIds.has(account.agentId));
    return <ProviderUsageStripContent entries={entries} onRefresh={refreshAgent} />;
});

export type ProviderUsageStripEntry = Readonly<{
    key: string;
    agentId: AgentId;
    /** Provider name, numbered ("Claude 2") only when that provider has several accounts. */
    label: string;
    gauge: ConnectedServiceQuotaGaugeViewModel | null;
}>;

/**
 * The strip's presentation; quota subscriptions stay at its connected owner above. One ring per
 * account, in order; account numbers appear only in the opened panel's headings.
 */
export function ProviderUsageStripContent({ entries, onRefresh }: Readonly<{
    entries: readonly ProviderUsageStripEntry[];
    onRefresh: (agentId: AgentId) => void;
}>) {
    const styles = stylesheet;
    const { height: windowHeight } = useWindowDimensions();
    const anchorRef = React.useRef<React.ElementRef<typeof View>>(null);
    const [open, setOpen] = React.useState(false);
    const firstAgentId = entries[0]?.agentId;
    if (!firstAgentId) return null;
    return (
        <>
            <Pressable
                ref={anchorRef}
                collapsable={false}
                testID="sessions-provider-usage-strip"
                style={styles.strip}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={t('agentInput.providerUsage.accessibilityLabel', {
                    value: entries.map((entry) => `${entry.label} ${entry.gauge?.badgeLabel ?? t('common.unavailable')}`).join(', '),
                })}
                onPress={() => {
                    onRefresh(firstAgentId);
                    setOpen((previous) => !previous);
                }}
            >
                <HorizontalOverflowScrollView contentContainerStyle={styles.providers} showsHorizontalScrollIndicator={false}>
                    {entries.map((entry) => (
                        <View
                            key={entry.key}
                            testID={`sessions-provider-usage-item:${entry.key}`}
                            style={styles.item}
                        >
                            <AgentIcon agentId={entry.agentId} size={STRIP_ICON_SIZE} />
                            <ProviderUsageRing gauge={entry.gauge} testID={`sessions-provider-usage:${entry.key}`} />
                        </View>
                    ))}
                </HorizontalOverflowScrollView>
            </Pressable>
            <AgentInputContentPopover
                open={open}
                anchorRef={anchorRef}
                placement="bottom"
                onRequestClose={() => setOpen(false)}
                maxHeightCap={windowHeight}
                maxWidthCap={420}
                outsidePointerEventsMode="full"
                testID="sessions-provider-usage-popover"
                content={open ? (
                    <View testID="sessions-provider-usage-sections">
                        {entries.map(({ key, agentId, label, gauge }) => {
                            return (
                                <View key={key} testID={`sessions-provider-usage-section:${key}`} style={styles.section}>
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
                                                <Text style={styles.providerName}>{label}</Text>
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
        // Two full touch targets beside the logo; additional providers remain horizontally reachable.
        maxWidth: PROVIDER_TOUCH_TARGET_SIZE * 2 + PROVIDER_GAP,
        minWidth: PROVIDER_TOUCH_TARGET_SIZE,
        flexShrink: 1,
    },
    providers: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: PROVIDER_GAP,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        minHeight: PROVIDER_TOUCH_TARGET_SIZE,
        minWidth: PROVIDER_TOUCH_TARGET_SIZE,
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
