import { describe, expect, it } from 'vitest';

import { buildModelVisibilityRows, filterVisibleModelOptions, getHiddenModelIds, setModelHidden } from './modelVisibility';

describe('model visibility', () => {
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
