import { describe, expect, it } from 'vitest';

import {
    buildModelVisibilityRows,
    collectObservedModelOptionsForProvider,
    filterVisibleModelOptions,
    getHiddenModelIds,
    selectOutdatedModelIds,
    setModelHidden,
} from './modelVisibility';

describe('model visibility', () => {
    it('hides every older version of a model family and keeps the newest', () => {
        const models = [
            { value: 'gpt-5.6-sol', label: 'GPT 5.6 Sol' },
            { value: 'gpt-6.1-sol', label: 'GPT 6.1 Sol' },
            { value: 'gpt-6.2-sol', label: 'GPT 6.2 Sol' },
            { value: 'claude-haiku-4-5', label: 'Haiku 4.5' },
            { value: 'claude-haiku-5-5', label: 'Haiku 5.5' },
            { value: 'claude-opus-4-5', label: 'Opus 4.5' },
            { value: 'claude-opus-4-5-20251101', label: 'Opus 4.5' },
            { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
            { value: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 1M' },
            { value: 'custom-model', label: 'Custom model' },
        ];
        expect(selectOutdatedModelIds(models)).toEqual(['gpt-5.6-sol', 'gpt-6.1-sol', 'claude-haiku-4-5']);
    });

    it('collects models observed by sessions of the same provider only', () => {
        const state = (provider: string, modelIds: readonly string[]) => ({
            sessionModelsV1: {
                v: 1,
                provider,
                updatedAt: 1,
                currentModelId: modelIds[0],
                availableModels: modelIds.map((id) => ({ id, name: id.toUpperCase() })),
            },
        });
        const sessions = [
            { metadata: state('claude', ['claude-haiku-5-5']) },
            { metadata: state('codex', ['gpt-6.2-sol']) },
            { metadata: null },
        ];
        expect(collectObservedModelOptionsForProvider(sessions as never, 'claude')).toEqual([
            { value: 'claude-haiku-5-5', label: 'CLAUDE-HAIKU-5-5' },
        ]);
    });

    it('keeps a hidden custom model restorable when a discovery refresh drops it', () => {
        const modelId = 'custom/__proto__/model:revision';
        const selections = setModelHidden([], { backendTargetKey: 'acpBackend:one', modelId, modelLabel: 'Custom model' }, true);
        const refreshed = [{ value: 'new-model', label: 'New model' }];
        expect(buildModelVisibilityRows(refreshed, selections)).toEqual([
            { modelId: 'new-model', modelLabel: 'New model', hidden: false },
            { modelId, modelLabel: 'Custom model', hidden: true },
        ]);

        const rediscovered = [{ value: modelId, label: 'Updated title' }, ...refreshed];
        expect(filterVisibleModelOptions(rediscovered, getHiddenModelIds(selections, 'acpBackend:one'))).toEqual(refreshed);
        expect(filterVisibleModelOptions(rediscovered, getHiddenModelIds(selections, 'acpBackend:two'))).toBe(rediscovered);

        const restored = setModelHidden(selections, { backendTargetKey: 'acpBackend:one', modelId }, false);
        expect(filterVisibleModelOptions(rediscovered, getHiddenModelIds(restored, 'acpBackend:one'))).toBe(rediscovered);
    });
});
