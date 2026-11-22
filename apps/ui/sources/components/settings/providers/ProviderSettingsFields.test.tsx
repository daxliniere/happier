import { describe, expect, it } from 'vitest';

import type { ProviderSettingsSectionDef } from '@/agents/providers/shared/providerSettingsPlugin';

import { splitProviderSettingsSectionsByPlacement } from './ProviderSettingsFields';

const section = (id: string, placement?: ProviderSettingsSectionDef['placement']): ProviderSettingsSectionDef => ({
    id,
    title: { key: 'settingsProviders.models' },
    fields: [],
    ...(placement ? { placement } : {}),
});

describe('splitProviderSettingsSectionsByPlacement', () => {
    it('separates sections placed in the models group from ordinary sections, keeping order', () => {
        const sections = [section('discovery', 'modelsGroup'), section('terminal'), section('experiments')];
        const { modelsGroupSections, sections: ordinary } = splitProviderSettingsSectionsByPlacement(sections);
        expect(modelsGroupSections.map((entry) => entry.id)).toEqual(['discovery']);
        expect(ordinary.map((entry) => entry.id)).toEqual(['terminal', 'experiments']);
    });
});
