import * as React from 'react';
import { buildBackendTargetKey } from '@happier-dev/protocol';
import type { AgentId } from '@/agents/catalog/catalog';
import type { Metadata } from '@/sync/domains/state/storageTypes';
import { supportsFreeformModelSelectionForSession, getModelOptionsForSession, type ModelOption, type SessionModelOptionsContext } from '@/sync/domains/models/modelOptions';
import type { OptionPickerProbeState } from '@/components/sessions/pickers/OptionPickerOverlay';
import { useNewSessionPreflightModelsState } from '@/components/sessions/new/hooks/screenModel/useNewSessionPreflightModelsState';

export type SessionModelDiscoveryContext = Parameters<typeof useNewSessionPreflightModelsState>[0];
export type AgentInputModelDetailState = Readonly<{
    modelOptions: readonly ModelOption[];
    backendTargetKey: string;
    modelOptionsContext?: SessionModelOptionsContext;
    canEnterCustomModel: boolean;
    probe?: OptionPickerProbeState;
}>;

/** Mounted by the engine picker's deferred detail owner, never by its closed chip. */
export function AgentInputModelDiscoveryDetail(props: Readonly<{
    agentId: AgentId;
    metadata: Metadata | null;
    modelOptions: readonly ModelOption[];
    modelOptionsBackendTargetKey?: string;
    discovery?: () => SessionModelDiscoveryContext;
    selectedModelId?: string;
    renderDetail: (state: AgentInputModelDetailState) => React.ReactNode;
}>) {
    const discovery = React.useMemo(() => props.discovery?.(), [props.discovery]);
    const backendTarget = discovery?.backendTarget ?? { kind: 'builtInAgent' as const, agentId: props.agentId };
    const { preflightModels, probe } = useNewSessionPreflightModelsState({
        backendTarget,
        selectedMachineId: discovery?.selectedMachineId ?? null,
        capabilityServerId: discovery?.capabilityServerId ?? '',
        cwd: discovery?.cwd,
        profileId: discovery?.profileId,
        probeContext: discovery?.probeContext,
        connectedServices: discovery?.connectedServices,
        enabled: Boolean(discovery) && discovery?.enabled !== false,
    });
    const modelOptionsContext = React.useMemo<SessionModelOptionsContext | undefined>(() => discovery ? ({
        preflight: preflightModels,
        preflightUpdatedAt: probe.refreshedAt,
        selectedModelId: props.selectedModelId,
    }) : undefined, [discovery, preflightModels, probe.refreshedAt, props.selectedModelId]);
    const modelOptions = React.useMemo(() => modelOptionsContext
        ? getModelOptionsForSession(props.agentId, props.metadata, modelOptionsContext)
        : props.modelOptions,
    [modelOptionsContext, props.agentId, props.metadata, props.modelOptions]);
    return props.renderDetail({
        modelOptions,
        backendTargetKey: props.modelOptionsBackendTargetKey ?? buildBackendTargetKey(backendTarget),
        modelOptionsContext,
        canEnterCustomModel: supportsFreeformModelSelectionForSession(props.agentId, props.metadata, modelOptionsContext),
        probe: discovery ? probe : undefined,
    });
}
