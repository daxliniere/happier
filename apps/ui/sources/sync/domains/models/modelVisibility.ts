import { z } from 'zod';
import { BackendTargetKeySchema } from '@happier-dev/protocol';

import { opaqueSessionControlIdentifierSchema } from '@/sync/domains/sessionControl/opaqueIdentifiers';

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
