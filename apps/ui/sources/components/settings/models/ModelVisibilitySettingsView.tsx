import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { getResolvedBackendCatalogEntries } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';
import { AGENT_IDS, DEFAULT_AGENT_ID, getAgentCore } from '@/agents/catalog/catalog';
import { listPreferredMachineIds } from '@/components/settings/pickers/resolvePreferredMachineId';
import { useNewSessionPreflightModelsState } from '@/components/sessions/new/hooks/screenModel/useNewSessionPreflightModelsState';
import { resolveNewSessionCapabilityProbeContext } from '@/components/sessions/new/modules/newSessionCapabilityProbeContext';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { FlashList } from '@/components/ui/lists/flashListCompat/FlashListCompat';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { TextInput } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import { buildModelVisibilityRows, setModelHidden, type HiddenModelSelectionV1 } from '@/sync/domains/models/modelVisibility';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { readNonBlankSessionControlIdentifier } from '@/sync/domains/sessionControl/opaqueIdentifiers';
import { useSettingMutable, useSettings } from '@/sync/domains/state/storage';
import { getStorage } from '@/sync/domains/state/storageStore';
import { useAllMachines } from '@/sync/store/hooks';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { fireAndForget } from '@/utils/system/fireAndForget';

const FALLBACK_TARGET = { kind: 'builtInAgent', agentId: DEFAULT_AGENT_ID } as const;
const EMPTY_MODELS = Object.freeze([]);

type VisibilityRow = ReturnType<typeof buildModelVisibilityRows>[number];

function modelRowKey(row: VisibilityRow) {
    return row.modelId;
}

export function ModelVisibilitySettingsView() {
    const maxWidth = useLayoutMaxWidth();
    const focused = useIsFocused();
    const settings = useSettings();
    const [hiddenModels, updateHiddenModels] = useSettingMutable('hiddenModelSelectionsV1');
    const machines = useAllMachines();
    const [providerKey, setProviderKey] = React.useState('');
    const [machineId, setMachineId] = React.useState<string | null>(null);
    const [openMenu, setOpenMenu] = React.useState<'provider' | 'machine' | null>(null);
    const [query, setQuery] = React.useState('');

    const entries = React.useMemo(() => getResolvedBackendCatalogEntries({
        enabledAgentIds: AGENT_IDS,
        acpCatalogSettingsV1: settings.acpCatalogSettingsV1,
    }).filter((entry) => getAgentCore(entry.providerAgentId).model.supportsSelection === true), [settings.acpCatalogSettingsV1]);
    const providerItems = React.useMemo(() => {
        const items = new Map(entries.map((entry) => [entry.targetKey, { id: entry.targetKey, title: entry.title, subtitle: entry.subtitle ?? undefined, testID: `model-visibility-provider:${entry.targetKey}` }]));
        for (const hidden of hiddenModels) {
            if (!items.has(hidden.backendTargetKey)) items.set(hidden.backendTargetKey, {
                id: hidden.backendTargetKey,
                title: hidden.backendLabel || hidden.backendTargetKey,
                subtitle: hidden.backendTargetKey,
                testID: `model-visibility-provider:${hidden.backendTargetKey}`,
            });
        }
        return [...items.values()];
    }, [entries, hiddenModels]);

    const provider = entries.find((entry) => entry.targetKey === providerKey);
    const providerLabel = providerItems.find((entry) => entry.id === providerKey)?.title;
    const backendTarget = provider?.target ?? FALLBACK_TARGET;
    const probeContext = resolveNewSessionCapabilityProbeContext({ backendTarget, settings });
    const machineItems = React.useMemo(() => {
        const labelsById = new Map(machines.map((machine) => [machine.id, getMachineDisplayName(machine)]));
        const onlineIds = listPreferredMachineIds({ machines, recentMachinePaths: settings.recentMachinePaths, onlineOnly: true });
        return onlineIds.map((id) => ({ id, title: labelsById.get(id) || id }));
    }, [machines, settings.recentMachinePaths]);
    const selectedMachineId = machineItems.some((machine) => machine.id === machineId) ? machineId : machineItems[0]?.id ?? null;
    const { modelOptions, probe } = useNewSessionPreflightModelsState({
        backendTarget,
        selectedMachineId: provider ? selectedMachineId : null,
        capabilityServerId: getActiveServerSnapshot().serverId ?? '',
        enabled: focused && Boolean(provider),
        probeContext,
    });

    const rows = React.useMemo(() => {
        const models = buildModelVisibilityRows(provider ? modelOptions : EMPTY_MODELS, hiddenModels.filter((model) => model.backendTargetKey === providerKey));
        const search = query.trim().toLowerCase();
        if (!search) return models;
        return models.filter(({ modelId, modelLabel }) => modelId.toLowerCase().includes(search) || modelLabel.toLowerCase().includes(search));
    }, [hiddenModels, modelOptions, provider, providerKey, query]);

    const changeVisibility = React.useCallback((model: Pick<HiddenModelSelectionV1, 'modelId' | 'modelLabel'>, hidden: boolean) => {
        const current = getStorage().getState().settings.hiddenModelSelectionsV1;
        updateHiddenModels(setModelHidden(current, { ...model, backendTargetKey: providerKey, backendLabel: providerLabel }, hidden));
    }, [providerKey, providerLabel, updateHiddenModels]);

    const renderRow = React.useCallback(({ item }: { item: VisibilityRow }) => (
        <Item
            title={item.modelLabel}
            subtitle={item.modelLabel === item.modelId ? undefined : item.modelId}
            showChevron={false}
            rightElement={(
                <Switch
                    testID={`model-visibility-switch:${item.modelId}`}
                    accessibilityLabel={t('modelVisibility.showModel', { model: item.modelLabel })}
                    value={!item.hidden}
                    onValueChange={(visible) => changeVisibility({ modelId: item.modelId, modelLabel: item.modelLabel }, !visible)}
                />
            )}
        />
    ), [changeVisibility]);

    const canDiscover = provider && getAgentCore(provider.providerAgentId).model.dynamicProbe !== 'static-only';
    return (
        <View style={[styles.container, { maxWidth }]}>
            <FlashList
                data={rows}
                keyExtractor={modelRowKey}
                renderItem={renderRow}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={(
                    <>
                        <ItemGroup footer={t('modelVisibility.description')}>
                            <DropdownMenu
                                open={openMenu === 'provider'}
                                onOpenChange={(open) => setOpenMenu(open ? 'provider' : null)}
                                items={providerItems}
                                selectedId={providerKey}
                                onSelect={(id) => {
                                    setProviderKey(id);
                                    setQuery('');
                                    setOpenMenu(null);
                                }}
                                variant="selectable"
                                rowKind="item"
                                search
                                matchTriggerWidth
                                itemTrigger={{
                                    title: t('modelVisibility.provider'),
                                    subtitle: providerLabel ?? t('modelVisibility.selectProvider'),
                                    showSelectedDetail: false,
                                    showSelectedSubtitle: false,
                                    itemProps: { testID: 'model-visibility-provider' },
                                }}
                            />
                            {canDiscover ? (
                                <DropdownMenu
                                    open={openMenu === 'machine'}
                                    onOpenChange={(open) => setOpenMenu(open ? 'machine' : null)}
                                    items={machineItems}
                                    selectedId={selectedMachineId ?? ''}
                                    onSelect={(id) => {
                                        setMachineId(id);
                                        setOpenMenu(null);
                                    }}
                                    variant="selectable"
                                    rowKind="item"
                                    search
                                    matchTriggerWidth
                                    itemTrigger={{
                                        title: t('newSession.selectMachineTitle'),
                                        subtitle: machineItems.find((machine) => machine.id === selectedMachineId)?.title ?? t('modelVisibility.noOnlineMachine'),
                                        showSelectedDetail: false,
                                        showSelectedSubtitle: false,
                                        itemProps: { testID: 'model-visibility-machine', disabled: machineItems.length === 0 },
                                    }}
                                />
                            ) : null}
                        </ItemGroup>
                        <ItemGroup>
                            {probe.onRefresh ? (
                                <Item
                                    testID="model-visibility-refresh"
                                    title={t('modelPickerOverlay.refreshModelsA11y')}
                                    subtitle={probe.phase === 'idle' ? (probe.error ? t('errors.unknownError') : undefined) : t(
                                        probe.phase === 'loading' ? 'modelPickerOverlay.loadingModelsA11y' : 'modelPickerOverlay.refreshingModelsA11y',
                                    )}
                                    onPress={probe.onRefresh}
                                    disabled={probe.phase !== 'idle'}
                                    showChevron={false}
                                />
                            ) : null}
                            {provider ? (
                                <Item
                                    testID="model-visibility-custom"
                                    title={t('modelVisibility.hideById')}
                                    onPress={() => fireAndForget((async () => {
                                        const raw = await Modal.prompt(t('modelVisibility.hideById'), t('modelVisibility.exactId'));
                                        const modelId = readNonBlankSessionControlIdentifier(raw);
                                        if (modelId && modelId !== 'default') {
                                            const model = modelOptions.find((option) => option.value === modelId);
                                            changeVisibility({ modelId, modelLabel: model?.label }, true);
                                            setQuery('');
                                        }
                                    })(), { tag: 'ModelVisibilitySettingsView.hideById' })}
                                    showChevron={false}
                                />
                            ) : null}
                            <Item
                                testID="model-visibility-show-all"
                                title={t('modelVisibility.showAll')}
                                disabled={hiddenModels.length === 0}
                                onPress={() => updateHiddenModels([])}
                                showChevron={false}
                            />
                        </ItemGroup>
                        {providerLabel ? (
                            <TextInput
                                testID="model-visibility-search"
                                accessibilityLabel={t('modelPickerOverlay.searchPlaceholder')}
                                placeholder={t('modelPickerOverlay.searchPlaceholder')}
                                value={query}
                                onChangeText={setQuery}
                                autoCorrect={false}
                                autoCapitalize="none"
                                style={styles.search}
                            />
                        ) : null}
                    </>
                )}
                ListEmptyComponent={providerLabel && probe.phase === 'idle' ? (
                    <Item title={t(query.trim() ? 'modelVisibility.noResults' : 'modelVisibility.empty')} showChevron={false} />
                ) : null}
            />
        </View>
    );
}

const styles = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
        width: '100%',
        alignSelf: 'center',
        backgroundColor: theme.colors.background.canvas,
    },
    search: {
        backgroundColor: theme.colors.input.background,
        color: theme.colors.input.text,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginHorizontal: 12,
        marginBottom: 12,
    },
}));
