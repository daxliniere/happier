import { z } from 'zod';
import { BackendTargetKeySchema } from '@happier-dev/protocol';

import type { AgentId } from '@/agents/catalog/catalog';
import { opaqueSessionControlIdentifierSchema } from '@/sync/domains/sessionControl/opaqueIdentifiers';
import { matchesSessionControlProvider, readSessionModelsState } from '@/sync/domains/sessionControl/readSessionControlMetadata';
import type { Metadata } from '@/sync/domains/state/storageTypes';

export const HiddenModelSelectionV1Schema = z.object({
    backendTargetKey: BackendTargetKeySchema,
    modelId: opaqueSessionControlIdentifierSchema.refine((id) => id !== 'default'),
    modelLabel: z.string().optional(),
    backendLabel: z.string().optional(),
});

export type HiddenModelSelectionV1 = z.infer<typeof HiddenModelSelectionV1Schema>;

const NO_HIDDEN_MODELS: ReadonlySet<string> = new Set();

export function getHiddenModelIds(
    selections: readonly HiddenModelSelectionV1[] | undefined,
    backendTargetKey: string | null | undefined,
): ReadonlySet<string> {
    if (!backendTargetKey || !selections?.length) return NO_HIDDEN_MODELS;
    const ids = new Set<string>();
    for (const entry of selections) {
        if (entry.backendTargetKey === backendTargetKey && entry.modelId !== 'default') ids.add(entry.modelId);
    }
    return ids.size > 0 ? ids : NO_HIDDEN_MODELS;
}

export function filterVisibleModelOptions<Option extends Readonly<{ value: string }>>(
    options: readonly Option[],
    hiddenIds: ReadonlySet<string>,
): readonly Option[] {
    return hiddenIds.size === 0 ? options : options.filter((option) => !hiddenIds.has(option.value));
}

export function setModelHidden(
    selections: readonly HiddenModelSelectionV1[],
    entry: HiddenModelSelectionV1,
    hidden: boolean,
): HiddenModelSelectionV1[] {
    const otherSelections = selections.filter((selection) => (
        selection.backendTargetKey !== entry.backendTargetKey || selection.modelId !== entry.modelId
    ));
    return hidden ? [...otherSelections, entry] : otherSelections;
}

export function buildModelVisibilityRows(
    availableModels: readonly Readonly<{ value: string; label: string }>[],
    hiddenModels: readonly HiddenModelSelectionV1[],
): readonly Readonly<{ modelId: string; modelLabel: string; hidden: boolean }>[] {
    const models = new Map<string, string>();
    const hiddenIds = new Set(hiddenModels.map((model) => model.modelId));
    for (const model of availableModels) {
        if (model.value !== 'default' && model.value.trim() && !models.has(model.value)) {
            models.set(model.value, model.label || model.value);
        }
    }
    for (const model of hiddenModels) {
        if (!models.has(model.modelId)) models.set(model.modelId, model.modelLabel || model.modelId);
    }
    return Array.from(models, ([modelId, modelLabel]) => ({ modelId, modelLabel, hidden: hiddenIds.has(modelId) }));
}

/**
 * Models that a running session of this provider has observed, in the same shape the composer
 * reads. The probe alone can lag behind the runtime (a static catalog may not list a model the
 * runtime already offers), so the manager lists these too.
 */
export function collectObservedModelOptionsForProvider(
    sessions: readonly Readonly<{ metadata: Metadata | null | undefined }>[],
    agentId: AgentId,
): readonly Readonly<{ value: string; label: string }>[] {
    const observed = new Map<string, string>();
    for (const session of sessions) {
        const state = readSessionModelsState(session.metadata);
        if (!state || !matchesSessionControlProvider({ agentId, metadata: session.metadata, provider: state.provider })) continue;
        for (const model of state.availableModels) {
            if (!observed.has(model.id)) observed.set(model.id, model.name);
        }
    }
    return Array.from(observed, ([value, label]) => ({ value, label }));
}

type ModelFamilyVersion = Readonly<{ id: string; family: string; version: readonly number[] }>;

/**
 * Split a model id into its family (the id with every version number replaced) and its version
 * numbers. Date snapshots (`-20251101`) are not versions, so a pinned snapshot shares its alias's
 * family. Bracketed variants such as `[1m]` are not separate releases and are never ranked.
 */
function readModelFamilyVersion(id: string): ModelFamilyVersion | null {
    if (id.includes('[')) return null;
    const normalized = id.toLowerCase().replace(/\b\d{8}\b/g, '');
    const tokens = normalized.match(/\d+(?:\.\d+)*/g);
    if (!tokens) return null;
    return {
        id,
        family: normalized.replace(/\d+(?:\.\d+)*/g, '#'),
        version: tokens.flatMap((token) => token.split('.').map(Number)),
    };
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

/**
 * Ids of every model that has a newer version in its own family, e.g. `gpt-5.6-sol` and
 * `gpt-6.1-sol` when `gpt-6.2-sol` is present. Models without a version are never outdated.
 */
export function selectOutdatedModelIds(models: readonly Readonly<{ value: string }>[]): readonly string[] {
    const parsed = models.flatMap((model) => {
        const entry = readModelFamilyVersion(model.value);
        return entry ? [entry] : [];
    });
    const newestByFamily = new Map<string, readonly number[]>();
    for (const entry of parsed) {
        const current = newestByFamily.get(entry.family);
        if (!current || compareVersions(entry.version, current) > 0) newestByFamily.set(entry.family, entry.version);
    }
    return parsed
        .filter((entry) => compareVersions(entry.version, newestByFamily.get(entry.family) ?? entry.version) < 0)
        .map((entry) => entry.id);
}
