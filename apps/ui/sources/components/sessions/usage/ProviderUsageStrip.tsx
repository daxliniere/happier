import * as React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import type { AgentId } from '@/agents/catalog/catalog';
import { useEnabledAgentIds } from '@/agents/hooks/useEnabledAgentIds';
import { AgentIcon } from '@/agents/registry/AgentIcon';
import { AgentInputContentPopover } from '@/components/sessions/agentInput/components/AgentInputContentPopover';
import { HorizontalOverflowScrollView } from '@/components/ui/scroll/HorizontalOverflowScrollView';
import { Text } from '@/components/ui/text/Text';
import { Typography } from '@/constants/Typography';
import type { ConnectedServiceQuotaGaugeViewModel } from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { useProfile, useSetting } from '@/sync/domains/state/storage';
import { t } from '@/text';

import { ProviderUsageDetails } from './ProviderUsageDetails';
import { resolveProviderUsageGaugeWindowMode } from './resolveProviderUsageGaugeWindowMode';
import { TokenUsageRing } from './TokenUsageRing';
import type { TokenUsageTone } from './tokenUsageTone';
import { useProviderUsageAccounts } from './useProviderUsageAccounts';

const ICON_SIZE = 12;
const TOUCH_TARGET_SIZE = 48;
const ITEM_GAP = 4;

/**
 * Remaining usage for every provider account, at the top of the sessions pane: one ring per
 * account, grouped by provider and in the order Settings lists the accounts. Tapping the strip
 * opens every account's usage details in one panel. Nothing renders without any account.
 */
export const ProviderUsageStrip = React.memo(function ProviderUsageStrip() {
    const agentIds = useEnabledAgentIds();
    const accountProfile = useProfile();
    const windowMode = resolveProviderUsageGaugeWindowMode(useSetting('sessionProviderUsageGaugeWindowMode'));
    const accounts = useProviderUsageAccounts({
        agentIds,
        connectedServices: accountProfile?.connectedServicesV2 ?? [],
        windowMode,
        fetchEnabled: true,
    });
    return <ProviderUsageStripContent entries={accounts} />;
});

export type ProviderUsageStripEntry = Readonly<{
    key: string;
    agentId: AgentId;
    /** Provider name, numbered ("Claude 2") only when that provider has several accounts. */
    label: string;
    gauge: ConnectedServiceQuotaGaugeViewModel | null;
}>;

function mapQuotaToneToTokenTone(tone: ConnectedServiceQuotaGaugeViewModel['tone']): TokenUsageTone {
    if (tone === 'critical') return 'critical';
    if (tone === 'warning') return 'warning';
    return 'neutral';
}

function ProviderUsageAccountRing(props: Readonly<{ entry: ProviderUsageStripEntry }>) {
    const gauge = props.entry.gauge;
    const label = `${props.entry.label} ${gauge?.badgeLabel ?? t('common.unavailable')}`;
    if (!gauge) {
        // An account without figures keeps an empty ring, so it stays visible and in place.
        return <TokenUsageRing used={0} limit={100} label={label} value="" testID={`sessions-provider-usage:${props.entry.key}`} />;
    }
    const rings = gauge.usageRings.length > 0
        ? gauge.usageRings
        : [{ usedPct: gauge.usedPct, tone: gauge.tone }];
    return (
        <TokenUsageRing
            used={100 - rings[0]!.usedPct}
            limit={100}
            rings={rings.map((ring) => ({ used: 100 - ring.usedPct, limit: 100, tone: mapQuotaToneToTokenTone(ring.tone) }))}
            label={label}
            value={gauge.ringValueLabel}
            tone={mapQuotaToneToTokenTone(gauge.tone)}
            testID={`sessions-provider-usage:${props.entry.key}`}
        />
    );
}

/** The strip's presentation; account numbers appear only in the opened panel's headings. */
export function ProviderUsageStripContent({ entries }: Readonly<{ entries: readonly ProviderUsageStripEntry[] }>) {
    const styles = stylesheet;
    const { height: windowHeight } = useWindowDimensions();
    const anchorRef = React.useRef<React.ElementRef<typeof View>>(null);
    const [open, setOpen] = React.useState(false);
    if (entries.length === 0) return null;
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
                onPress={() => setOpen((previous) => !previous)}
            >
                <HorizontalOverflowScrollView contentContainerStyle={styles.items} showsHorizontalScrollIndicator={false}>
                    {entries.map((entry) => (
                        <View key={entry.key} testID={`sessions-provider-usage-item:${entry.key}`} style={styles.item}>
                            <AgentIcon agentId={entry.agentId} size={ICON_SIZE} />
                            <ProviderUsageAccountRing entry={entry} />
                        </View>
                    ))}
                </HorizontalOverflowScrollView>
            </Pressable>
            <AgentInputContentPopover
                open={open}
                anchorRef={anchorRef}
                onRequestClose={() => setOpen(false)}
                maxHeightCap={windowHeight}
                maxWidthCap={420}
                testID="sessions-provider-usage-popover"
                content={open ? (
                    <View testID="sessions-provider-usage-sections">
                        {entries.map((entry) => (
                            <View key={entry.key} testID={`sessions-provider-usage-section:${entry.key}`} style={styles.section}>
                                {entry.gauge ? (
                                    <ProviderUsageDetails viewModel={entry.gauge} />
                                ) : (
                                    <View style={styles.unavailable}>
                                        <Text style={styles.providerName}>
                                            {t('agentInput.providerUsage.titleForProvider', { provider: entry.label })}
                                        </Text>
                                        <Text style={styles.unavailableLabel}>{t('common.unavailable')}</Text>
                                    </View>
                                )}
                            </View>
                        ))}
                    </View>
                ) : null}
            />
        </>
    );
}

const stylesheet = StyleSheet.create((theme) => ({
    strip: {
        alignSelf: 'stretch',
        paddingHorizontal: 12,
    },
    items: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: ITEM_GAP,
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        minHeight: TOUCH_TARGET_SIZE,
        minWidth: TOUCH_TARGET_SIZE,
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
