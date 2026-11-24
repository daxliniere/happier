import * as React from 'react';
import { useIsFocused } from '@react-navigation/native';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { StyleSheet } from 'react-native-unistyles';
import { buildBackendTargetKey, type BackendTargetRefV1 } from '@happier-dev/protocol';

import { getResolvedBackendCatalogEntries } from '@/agents/backendCatalog/getResolvedBackendCatalogEntries';
import { AGENT_IDS, DEFAULT_AGENT_ID, getAgentCore } from '@/agents/catalog/catalog';
import { resolveAgentIdFromFlavor } from '@/agents/registry/registryCore';
import { listPreferredMachineIds } from '@/components/settings/pickers/resolvePreferredMachineId';
import { useNewSessionPreflightModelsState } from '@/components/sessions/new/hooks/screenModel/useNewSessionPreflightModelsState';
import {
    buildNewSessionCapabilityProbeContextKey,
    resolveNewSessionCapabilityProbeContext,
    type NewSessionCapabilityProbeContext,
} from '@/components/sessions/new/modules/newSessionCapabilityProbeContext';
import type { ModelOption } from '@/sync/domains/models/modelOptions';
import { DropdownMenu } from '@/components/ui/forms/dropdown/DropdownMenu';
import { Switch } from '@/components/ui/forms/Switch';
import { useLayoutMaxWidth } from '@/components/ui/layout/layout';
import { FlashList } from '@/components/ui/lists/flashListCompat/FlashListCompat';
import { Item } from '@/components/ui/lists/Item';
import { ItemGroup } from '@/components/ui/lists/ItemGroup';
import { TextInput } from '@/components/ui/text/Text';
import { Modal } from '@/modal';
import {
    buildModelVisibilityRows,
    collectObservedModelOptionsForProvider,
    groupModelVisibilityRows,
    selectOutdatedModelIds,
    setModelHidden,
    type HiddenModelSelectionV1,
    type ModelVisibilityGroup,
} from '@/sync/domains/models/modelVisibility';
import { getActiveServerSnapshot } from '@/sync/domains/server/serverRuntime';
import { readNonBlankSessionControlIdentifier } from '@/sync/domains/sessionControl/opaqueIdentifiers';
import { useSettingMutable, useSettings } from '@/sync/domains/state/storage';
import { getStorage } from '@/sync/domains/state/storageStore';
import { useAllMachines, useSessions } from '@/sync/store/hooks';
import { t } from '@/text';
import { getMachineDisplayName } from '@/utils/sessions/machineUtils';
import { fireAndForget } from '@/utils/system/fireAndForget';

const FALLBACK_TARGET = { kind: 'builtInAgent', agentId: DEFAULT_AGENT_ID } as const;
const EMPTY_MODELS = Object.freeze([]);
const EMPTY_SESSIONS = Object.freeze([]);
const EMPTY_CONTEXTS: readonly Readonly<{ contextKey: string; context: NewSessionCapabilityProbeContext | null }>[] = Object.freeze([]);

function modelRowKey(group: ModelVisibilityGroup) {
    return group.modelIds[0] ?? group.modelLabel;
}

/**
 * Probes one capability context that the default probe does not cover (a session's runtime
 * context) and reports its models upward. Renders nothing.
 */
const SessionContextModelsProbe = React.memo(function SessionContextModelsProbe(props: Readonly<{
    contextKey: string;
    backendTarget: BackendTargetRefV1;
    probeContext: NewSessionCapabilityProbeContext | null;
    selectedMachineId: string | null;
    capabilityServerId: string;
    enabled: boolean;
    onModels: (contextKey: string, modelOptions: readonly ModelOption[]) => void;
}>) {
    const { modelOptions } = useNewSessionPreflightModelsState({
        backendTarget: props.backendTarget,
        selectedMachineId: props.selectedMachineId,
        capabilityServerId: props.capabilityServerId,
        enabled: props.enabled,
        probeContext: props.probeContext,
    });
    const { contextKey, onModels } = props;
    React.useEffect(() => {
        onModels(contextKey, modelOptions);
    }, [contextKey, modelOptions, onModels]);
    return null;
});

export function ModelVisibilitySettingsView() {
    const maxWidth = useLayoutMaxWidth();
    const focused = useIsFocused();
    const settings = useSettings();
    const [hiddenModels, updateHiddenModels] = useSettingMutable('hiddenModelSelectionsV1');
    const machines = useAllMachines();
    const sessions = useSessions() ?? EMPTY_SESSIONS;
    const params = useLocalSearchParams<{ agentId?: string }>();
    const fixedAgentId = AGENT_IDS.find((agentId) => agentId === params.agentId);
    const fixedTargetKey = fixedAgentId ? buildBackendTargetKey({ kind: 'builtInAgent', agentId: fixedAgentId }) : null;
    const [selectedProviderKey, setProviderKey] = React.useState('');
    const providerKey = fixedTargetKey ?? selectedProviderKey;
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

    const observedModels = React.useMemo(
        () => (provider ? collectObservedModelOptionsForProvider(sessions, provider.providerAgentId) : EMPTY_MODELS),
        [provider?.providerAgentId, sessions],
    );
    // The composer probes with each session's own runtime context (SessionView), which can list
    // models the settings context does not. Probe every distinct context this provider's sessions use.
    const [contextModels, setContextModels] = React.useState<Readonly<Record<string, readonly ModelOption[]>>>({});
    const handleContextModels = React.useCallback((contextKey: string, options: readonly ModelOption[]) => {
        setContextModels((previous) => (previous[contextKey] === options ? previous : { ...previous, [contextKey]: options }));
    }, []);
    const sessionProbeContexts = React.useMemo(() => {
        if (!provider) return EMPTY_CONTEXTS;
        const defaultKey = buildNewSessionCapabilityProbeContextKey(probeContext);
        const byKey = new Map<string, NewSessionCapabilityProbeContext | null>();
        for (const session of sessions) {
            if (resolveAgentIdFromFlavor(session.metadata?.flavor) !== provider.providerAgentId) continue;
            const context = resolveNewSessionCapabilityProbeContext({ backendTarget, settings, sessionMetadata: session.metadata });
            const key = buildNewSessionCapabilityProbeContextKey(context);
            if (key !== defaultKey && !byKey.has(key)) byKey.set(key, context);
        }
        return [...byKey].map(([contextKey, context]) => ({ contextKey, context }));
    }, [backendTarget, probeContext, provider, sessions, settings]);
    const allRows = React.useMemo(() => {
        const known = provider
            ? [...modelOptions, ...Object.values(contextModels).flatMap((options) => options), ...observedModels]
            : EMPTY_MODELS;
        return buildModelVisibilityRows(known, hiddenModels.filter((model) => model.backendTargetKey === providerKey));
    }, [contextModels, hiddenModels, modelOptions, observedModels, provider, providerKey]);
    const outdatedModelIds = React.useMemo(() => selectOutdatedModelIds(allRows.map((row) => ({ value: row.modelId })))
        .filter((modelId) => allRows.some((row) => row.modelId === modelId && !row.hidden)), [allRows]);
    const groups = React.useMemo(() => groupModelVisibilityRows(allRows), [allRows]);
    const outdatedGroups = React.useMemo(
        () => groups.filter((group) => group.modelIds.some((modelId) => outdatedModelIds.includes(modelId))),
        [groups, outdatedModelIds],
    );
    const rows = React.useMemo(() => {
        const search = query.trim().toLowerCase();
        if (!search) return groups;
        return groups.filter(({ modelIds, modelLabel }) => modelLabel.toLowerCase().includes(search)
            || modelIds.some((modelId) => modelId.toLowerCase().includes(search)));
    }, [groups, query]);

    const changeVisibility = React.useCallback((models: readonly Pick<HiddenModelSelectionV1, 'modelId' | 'modelLabel'>[], hidden: boolean) => {
        let current = getStorage().getState().settings.hiddenModelSelectionsV1;
        for (const model of models) {
            current = setModelHidden(current, { ...model, backendTargetKey: providerKey, backendLabel: providerLabel }, hidden);
        }
        updateHiddenModels(current);
    }, [providerKey, providerLabel, updateHiddenModels]);

    const hideOutdated = React.useCallback(() => {
        changeVisibility(
            outdatedGroups.flatMap((group) => group.modelIds.map((modelId) => ({ modelId, modelLabel: group.modelLabel }))),
            true,
        );
    }, [changeVisibility, outdatedGroups]);

    const renderRow = React.useCallback(({ item }: { item: ModelVisibilityGroup }) => (
        <Item
            title={item.modelLabel}
            subtitle={item.modelIds.length === 1 && item.modelIds[0] === item.modelLabel ? undefined : item.modelIds.join(', ')}
            showChevron={false}
            rightElement={(
                <Switch
                    testID={`model-visibility-switch:${item.modelIds[0]}`}
                    accessibilityLabel={t('modelVisibility.showModel', { model: item.modelLabel })}
                    value={!item.hidden}
                    onValueChange={(visible) => changeVisibility(
                        item.modelIds.map((modelId) => ({ modelId, modelLabel: item.modelLabel })),
                        !visible,
                    )}
                />
            )}
        />
    ), [changeVisibility]);

    const canDiscover = provider && getAgentCore(provider.providerAgentId).model.dynamicProbe !== 'static-only';
    return (
        <View style={[styles.container, { maxWidth }]}>
            {sessionProbeContexts.map(({ contextKey, context }) => (
                <SessionContextModelsProbe
                    key={contextKey}
                    contextKey={contextKey}
                    backendTarget={backendTarget}
                    probeContext={context}
                    selectedMachineId={provider ? selectedMachineId : null}
                    capabilityServerId={getActiveServerSnapshot().serverId ?? ''}
                    enabled={focused && Boolean(provider)}
                    onModels={handleContextModels}
                />
            ))}
            <FlashList
                data={rows}
                keyExtractor={modelRowKey}
                renderItem={renderRow}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={(
                    <>
                        <ItemGroup footer={t('modelVisibility.description')}>
                            {fixedAgentId ? null : <DropdownMenu
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
                            />}
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
                                    subtitle={probe.phase === 'idle' ? (probe.error ? t('modelVisibility.refreshFailed') : undefined) : t(
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
                                            changeVisibility([{ modelId, modelLabel: model?.label }], true);
                                            setQuery('');
                                        }
                                    })(), { tag: 'ModelVisibilitySettingsView.hideById' })}
                                    showChevron={false}
                                />
                            ) : null}
                            <Item
                                testID="model-visibility-hide-outdated"
                                title={t('modelVisibility.hideOutdated')}
                                disabled={outdatedGroups.length === 0}
                                onPress={hideOutdated}
                                showChevron={false}
                            />
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
