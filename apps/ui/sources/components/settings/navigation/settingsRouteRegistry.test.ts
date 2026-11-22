import { describe, expect, it } from 'vitest';

import {
    getSettingsBreadcrumbs,
    getSettingsStackScreenDefinitions,
    resolveSettingsBreadcrumbs,
} from './settingsRouteRegistry';

describe('settingsRouteRegistry', () => {
    it('gives the prompts navigator ownership of its screen headers', () => {
        const settings = getSettingsStackScreenDefinitions((key) => key);
        expect(settings.find((entry) => entry.name === 'prompts')?.options.headerShown).toBe(false);
        expect(settings.some((entry) => entry.name.startsWith('prompts/'))).toBe(false);

        const prompts = getSettingsStackScreenDefinitions((key) => key, 'prompts');
        expect(prompts.find((entry) => entry.name === 'docs/index')?.options).toMatchObject({ headerShown: true });
        expect(typeof prompts.find((entry) => entry.name === 'index')?.options.headerTitle).toBe('function');
        expect(prompts.some((entry) => entry.name === 'account')).toBe(false);
    });

    it('registers the actions detail route chrome', () => {
        const definitions = getSettingsStackScreenDefinitions((key) => key);
        const routeNames = definitions.map((definition) => definition.name);

        expect(routeNames).toContain('actions/[actionId]');
    });

    it('gives native login import the shared settings header and back navigation', () => {
        const definition = getSettingsStackScreenDefinitions((key) => key)
            .find((entry) => entry.name === 'connected-services/import');

        expect(definition?.options).toMatchObject({
            headerBackTitle: 'common.back',
            headerShown: true,
        });
        expect(typeof definition?.options.headerTitle).toBe('function');
    });

    it('links every upper level of a nested settings screen and not the current one', () => {
        const crumbs = getSettingsBreadcrumbs(
            (key) => key,
            'connected-services/provider-state-sharing',
            [
                { name: 'connected-services/index', titleKey: 'settings.connectedServices' },
                { name: 'connected-services/provider-state-sharing', titleKey: 'connectedServices.providerStateSharing.title' },
            ],
            'settings',
        );
        expect(crumbs).toEqual([
            { title: 'settings.title', href: '/settings' },
            { title: 'settings.connectedServices', href: '/settings/connected-services' },
            { title: 'connectedServices.providerStateSharing.title' },
        ]);
    });

    it('roots prompts breadcrumbs under the prompts navigator and templates parents that need params', () => {
        const crumbs = getSettingsBreadcrumbs(
            (key) => key,
            'docs/[id]/export',
            [
                { name: 'docs/index', titleKey: 'promptLibrary.prompts' },
                { name: 'docs/[id]', titleKey: 'promptLibrary.editPrompt' },
                { name: 'docs/[id]/export', titleKey: 'promptLibrary.externalAssetsExportTitle' },
            ],
            'prompts',
        );
        expect(crumbs).toEqual([
            { title: 'settings.title', href: '/settings' },
            { title: 'settings.prompts', href: '/settings/prompts' },
            { title: 'promptLibrary.prompts', href: '/settings/prompts/docs' },
            { title: 'promptLibrary.editPrompt', href: '/settings/prompts/docs/[id]' },
            { title: 'promptLibrary.externalAssetsExportTitle' },
        ]);
    });

    it('fills parent links from route params and leaves them plain when params are missing', () => {
        const crumbs = [
            { title: 'Prompts', href: '/settings/prompts/docs' },
            { title: 'Edit prompt', href: '/settings/prompts/docs/[id]' },
            { title: 'Export' },
        ];
        expect(resolveSettingsBreadcrumbs(crumbs, { id: 'a b/c' })).toEqual([
            { title: 'Prompts', href: '/settings/prompts/docs' },
            { title: 'Edit prompt', href: '/settings/prompts/docs/a%20b%2Fc' },
            { title: 'Export' },
        ]);
        expect(resolveSettingsBreadcrumbs(crumbs, undefined)).toEqual([
            { title: 'Prompts', href: '/settings/prompts/docs' },
            { title: 'Edit prompt' },
            { title: 'Export' },
        ]);
    });

    it('keeps the parent link when a detail screen shares its parent title', () => {
        const definitions = getSettingsStackScreenDefinitions((key) => key);
        expect(definitions.find((entry) => entry.name === 'actions/[actionId]')?.breadcrumbs).toEqual([
            { title: 'settings.title', href: '/settings' },
            { title: 'common.actions', href: '/settings/actions' },
        ]);
        expect(definitions.find((entry) => entry.name === 'actions')?.breadcrumbs).toEqual([
            { title: 'settings.title', href: '/settings' },
            { title: 'common.actions' },
        ]);
        expect(definitions.find((entry) => entry.name === 'index')?.breadcrumbs).toEqual([
            { title: 'settings.title' },
        ]);
    });

    it('follows the navigation parent for screens registered outside their parent route', () => {
        const definitions = getSettingsStackScreenDefinitions((key) => key);
        const trail = (name: string) => definitions.find((entry) => entry.name === name)?.breadcrumbs
            ?.map((crumb) => crumb.title);

        expect(trail('model-visibility')).toEqual(['settings.title', 'settingsProviders.title', 'modelVisibility.title']);
        expect(trail('acp-backend')).toEqual(['settings.title', 'settingsProviders.title', 'settings.acpCatalogBackendEditorTitle']);
        expect(trail('language')).toEqual(['settings.title', 'settings.appearance', 'settingsLanguage.currentLanguage']);
        expect(trail('mcp-server')).toEqual(['settings.title', 'settings.mcpServers', 'settings.mcpServersEditorTitle']);
        expect(trail('diagnosis')).toEqual(['settings.title', 'settings.systemStatus', 'diagnosis.title']);
    });

    it('nests connected-service sub-screens under the named service', () => {
        const definitions = getSettingsStackScreenDefinitions((key) => key);
        const resolved = (name: string) => resolveSettingsBreadcrumbs(
            definitions.find((entry) => entry.name === name)?.breadcrumbs ?? [],
            { serviceId: 'claude-subscription', profileId: 'work' },
        );

        expect(resolved('connected-services/profile')).toEqual([
            { title: 'settings.title', href: '/settings' },
            { title: 'settings.connectedServices', href: '/settings/connected-services' },
            { title: 'connectedServices.serviceNames.claudeSubscription', href: '/settings/connected-services/claude-subscription' },
            { title: 'connectedServices.profile.profileId' },
        ]);
        expect(resolved('connected-services/[serviceId]')).toEqual([
            { title: 'settings.title', href: '/settings' },
            { title: 'settings.connectedServices', href: '/settings/connected-services' },
            { title: 'connectedServices.serviceNames.claudeSubscription' },
        ]);
        expect(typeof definitions.find((entry) => entry.name === 'connected-services/oauth')?.routeOptions).toBe('function');
    });
});
