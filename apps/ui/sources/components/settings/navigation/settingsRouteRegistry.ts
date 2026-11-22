import * as React from 'react';
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { ConnectedServiceIdSchema } from '@happier-dev/protocol';

import { resolveConnectedServiceDisplayName } from '@/components/settings/connectedServices/model/resolveConnectedServiceDisplayName';
import type { TranslationKeyNoParams } from '@/text';

import { SettingsBreadcrumbHeaderTitle } from './SettingsBreadcrumbHeaderTitle';

type Translate = (key: TranslationKeyNoParams) => string;

export type SettingsStackScope = 'settings' | 'prompts';

export type SettingsStackScreenDefinition = Readonly<{
    name: string;
    options: NativeStackNavigationOptions;
    /** Breadcrumb trail for titled screens; links may hold `[param]` segments to resolve per route. */
    breadcrumbs?: readonly SettingsBreadcrumb[];
    /** Present when the breadcrumbs depend on route params: builds the screen options for a route's params. */
    routeOptions?: (params: SettingsRouteParams) => NativeStackNavigationOptions;
}>;

/** Header title rendering the breadcrumb trail, with `[param]` links filled from the given route params. */
export function createSettingsBreadcrumbHeaderTitle(
    breadcrumbs: readonly SettingsBreadcrumb[],
    params?: SettingsRouteParams,
): NonNullable<NativeStackNavigationOptions['headerTitle']> {
    const resolved = resolveSettingsBreadcrumbs(breadcrumbs, params);
    return ({ tintColor }) => React.createElement(SettingsBreadcrumbHeaderTitle, { breadcrumbs: resolved, tintColor });
}

export type SettingsBreadcrumb = Readonly<{
    title: string;
    /**
     * Route to open when the crumb is pressed; absent for the current screen.
     * May hold `[param]` segments, filled from the current route's params by `resolveSettingsBreadcrumbs`.
     */
    href?: string;
    /** Title derived from the current route's params (e.g. the service name); `title` is the fallback. */
    resolveTitle?: (params: SettingsRouteParams) => string | undefined;
}>;

export type SettingsRouteParams = Readonly<Record<string, unknown>> | undefined;

function getSettingsBreadcrumbHref(routeName: string, scope: SettingsStackScope): string {
    const base = scope === 'prompts' ? '/settings/prompts' : '/settings';
    const path = routeName === 'index' ? '' : routeName.replace(/\/index$/, '');
    return path ? `${base}/${path}` : base;
}

function resolveSettingsBreadcrumbHref(href: string, params: SettingsRouteParams): string | undefined {
    let resolvable = true;
    const resolved = href.replace(/\[([^\]]+)\]/g, (_segment, name: string) => {
        const value = params?.[name];
        if (typeof value !== 'string' || value.length === 0) {
            resolvable = false;
            return '';
        }
        return encodeURIComponent(value);
    });
    return resolvable ? resolved : undefined;
}

/** Fills `[param]` segments of each crumb link from the current route; a link whose params are missing becomes plain text. */
export function resolveSettingsBreadcrumbs(
    breadcrumbs: readonly SettingsBreadcrumb[],
    params: SettingsRouteParams,
): readonly SettingsBreadcrumb[] {
    return breadcrumbs.map((crumb) => {
        const title = crumb.resolveTitle?.(params) ?? crumb.title;
        const href = crumb.href ? resolveSettingsBreadcrumbHref(crumb.href, params) : undefined;
        return href ? { title, href } : { title };
    });
}

function settingsBreadcrumbsNeedRouteParams(breadcrumbs: readonly SettingsBreadcrumb[]): boolean {
    return breadcrumbs.some((crumb) => crumb.resolveTitle !== undefined || crumb.href?.includes('[') === true);
}

/**
 * The screen a route is reached from: its declared `parent`, otherwise the nearest registered route
 * above it in the URL path (`a/b` or `a/b/index` for `a/b/c`). Top-level routes have none.
 */
function getSettingsParentRouteName(
    name: string,
    definitions: readonly SettingsRouteChromeDefinition[],
): string | undefined {
    const declared = definitions.find((definition) => definition.name === name)?.parent;
    if (declared) return declared;
    const segments = name.replace(/\/index$/, '').split('/');
    for (let length = segments.length - 1; length > 0; length -= 1) {
        const prefix = segments.slice(0, length).join('/');
        const match = definitions.find((definition) => definition.name === prefix || definition.name === `${prefix}/index`);
        if (match) return match.name;
    }
    return undefined;
}

export function getSettingsBreadcrumbs(
    t: Translate,
    name: string,
    definitions: readonly SettingsRouteChromeDefinition[],
    scope: SettingsStackScope,
): readonly SettingsBreadcrumb[] {
    const crumbs: { title: string; href: string; resolveTitle?: SettingsBreadcrumb['resolveTitle'] }[] = [
        { title: t('settings.title'), href: '/settings' },
    ];
    if (scope === 'prompts') crumbs.push({ title: t('settings.prompts'), href: '/settings/prompts' });

    const chain: string[] = [];
    for (
        let routeName: string | undefined = name;
        routeName !== undefined && !chain.includes(routeName);
        routeName = getSettingsParentRouteName(routeName, definitions)
    ) {
        chain.unshift(routeName);
    }
    for (const routeName of chain) {
        const definition = definitions.find((entry) => entry.name === routeName);
        if (!definition?.titleKey) continue;
        const titleFromParams = definition.titleFromParams;
        crumbs.push({
            title: t(definition.titleKey),
            href: getSettingsBreadcrumbHref(routeName, scope),
            ...(titleFromParams ? { resolveTitle: (params: SettingsRouteParams) => titleFromParams(params, t) } : {}),
        });
    }

    // A parent that shares its title with the next level collapses into one crumb that keeps the parent's link.
    const deduped: (typeof crumbs[number] & { absorbedCurrentHref?: string })[] = [];
    crumbs.forEach((crumb, index) => {
        const previous = deduped[deduped.length - 1];
        if (previous && previous.title === crumb.title) {
            if (index === crumbs.length - 1) previous.absorbedCurrentHref = crumb.href;
            return;
        }
        deduped.push({ ...crumb });
    });
    const withTitle = (crumb: (typeof deduped)[number], href?: string): SettingsBreadcrumb => ({
        title: crumb.title,
        ...(href ? { href } : {}),
        ...(crumb.resolveTitle ? { resolveTitle: crumb.resolveTitle } : {}),
    });
    // The last crumb is the current screen: show it, but never as a link to itself. When the current screen
    // collapsed into a parent at another route (e.g. an Action detail under "Actions"), keep the parent's link.
    return deduped.map((crumb, index) => {
        if (index < deduped.length - 1) return withTitle(crumb, crumb.href);
        const linksElsewhere = crumb.absorbedCurrentHref !== undefined && crumb.absorbedCurrentHref !== crumb.href;
        return withTitle(crumb, linksElsewhere ? crumb.href : undefined);
    });
}

type SettingsRouteChromeDefinition = Readonly<{
    name: string;
    titleKey?: TranslationKeyNoParams;
    /** Route of the screen this one is opened from, when that is not its URL parent. */
    parent?: string;
    /** Title from route params, shown in place of `titleKey` when it resolves. */
    titleFromParams?: (params: SettingsRouteParams, t: Translate) => string | undefined;
    headerBackTitleKey?: TranslationKeyNoParams;
    headerShown?: boolean;
}>;

function connectedServiceTitle(params: SettingsRouteParams, t: Translate): string | undefined {
    const parsed = ConnectedServiceIdSchema.safeParse(params?.serviceId);
    return parsed.success ? resolveConnectedServiceDisplayName(parsed.data, t) : undefined;
}

const SETTINGS_ROUTE_CHROME_DEFINITIONS: readonly SettingsRouteChromeDefinition[] = [
    { name: 'index', titleKey: 'settings.title', headerBackTitleKey: 'common.home' },
    { name: 'account', titleKey: 'settings.account' },
    { name: 'acp-backend', titleKey: 'settings.acpCatalogBackendEditorTitle', parent: 'providers/index' },
    { name: 'acp', titleKey: 'settings.acpCatalog' },
    { name: 'actions', titleKey: 'common.actions' },
    { name: 'actions/[actionId]', titleKey: 'common.actions' },
    { name: 'add-phone', titleKey: 'settings.addYourPhone' },
    { name: 'app-lock', titleKey: 'appLock.settingsTitle' },
    { name: 'appearance', titleKey: 'settings.appearance' },
    { name: 'appearance/themes', titleKey: 'settingsAppearance.themeProfiles.title' },
    { name: 'appearance/themes/[profileId]', titleKey: 'settingsAppearance.themeProfiles.editorTitle' },
    { name: 'appearance/themes/import', titleKey: 'settingsAppearance.themeProfiles.importProfile' },
    { name: 'appearance/themes/export', titleKey: 'settingsAppearance.themeProfiles.exportProfile' },
    { name: 'attachments', titleKey: 'settings.attachments' },
    { name: 'connect/claude', headerShown: false },
    { name: 'connected-services/index', titleKey: 'settings.connectedServices' },
    { name: 'connected-services/[serviceId]', titleKey: 'connectedServices.fallbackName', titleFromParams: connectedServiceTitle },
    { name: 'connected-services/group', titleKey: 'connectedServices.detail.groupDetail.routeTitle', parent: 'connected-services/[serviceId]' },
    { name: 'connected-services/import', titleKey: 'connectedServices.importAccounts.title', parent: 'connected-services/[serviceId]' },
    { name: 'connected-services/oauth', titleKey: 'connectedServices.detail.addOauthProfileTitle', parent: 'connected-services/[serviceId]' },
    { name: 'connected-services/profile', titleKey: 'connectedServices.profile.profileId', parent: 'connected-services/[serviceId]' },
    { name: 'connected-services/provider-state-sharing', titleKey: 'connectedServices.providerStateSharing.title' },
    { name: 'diagnosis', titleKey: 'diagnosis.title', parent: 'system-status' },
    { name: 'features', titleKey: 'settings.features' },
    { name: 'file-opening', titleKey: 'settingsDesktop.pathMappingsTitle' },
    { name: 'keyboard', titleKey: 'settingsKeyboard.title' },
    { name: 'language', titleKey: 'settingsLanguage.currentLanguage', parent: 'appearance' },
    { name: 'machines', titleKey: 'settings.machines' },
    { name: 'machines/add', titleKey: 'settings.addMachine' },
    { name: 'machines/this-computer', titleKey: 'settings.machineSetupCurrentMachineTitle' },
    { name: 'mcp-server', titleKey: 'settings.mcpServersEditorTitle', parent: 'mcp' },
    { name: 'mcp', titleKey: 'settings.mcpServers' },
    { name: 'memory', titleKey: 'settings.memorySearch' },
    { name: 'model-visibility', titleKey: 'modelVisibility.title', parent: 'providers/index' },
    { name: 'notifications', titleKey: 'settings.notifications' },
    { name: 'notifications/push', titleKey: 'settingsNotifications.push.troubleshootTitle' },
    { name: 'pets', titleKey: 'settingsPets.title' },
    { name: 'profiles', titleKey: 'settingsFeatures.profiles' },
    { name: 'prompts/assets', titleKey: 'promptLibrary.externalAssets' },
    { name: 'prompts/docs/[id]', titleKey: 'promptLibrary.editPrompt' },
    { name: 'prompts/docs/[id]/export', titleKey: 'promptLibrary.externalAssetsExportTitle' },
    { name: 'prompts/docs/index', titleKey: 'promptLibrary.prompts' },
    { name: 'prompts/docs/new', titleKey: 'promptLibrary.newPrompt' },
    { name: 'prompts/folders', titleKey: 'promptLibrary.folders' },
    { name: 'prompts/index', titleKey: 'settings.prompts' },
    { name: 'prompts/library', headerShown: false },
    { name: 'prompts/registries', titleKey: 'promptLibrary.registries' },
    { name: 'prompts/registries/item', titleKey: 'promptLibrary.registries' },
    { name: 'prompts/skills/[id]', titleKey: 'promptLibrary.editSkill' },
    { name: 'prompts/skills/[id]/export', titleKey: 'promptLibrary.externalAssetsExportTitle' },
    { name: 'prompts/skills/[id]/files/edit', titleKey: 'promptLibrary.editSupportingFile' },
    { name: 'prompts/skills/[id]/files/new', titleKey: 'promptLibrary.newSupportingFile' },
    { name: 'prompts/skills/index', titleKey: 'promptLibrary.skills' },
    { name: 'prompts/skills/new', titleKey: 'promptLibrary.newSkill' },
    { name: 'prompts/stacks', titleKey: 'promptLibrary.stacks' },
    { name: 'prompts/stacks/coding', titleKey: 'promptLibrary.codingStack' },
    { name: 'prompts/stacks/pick', titleKey: 'promptLibrary.addToStack' },
    { name: 'prompts/stacks/profiles/[id]', titleKey: 'promptLibrary.profileStacks' },
    { name: 'prompts/stacks/profiles/index', titleKey: 'promptLibrary.profileStacks' },
    { name: 'prompts/stacks/voice', titleKey: 'promptLibrary.voiceStack' },
    { name: 'prompts/templates', titleKey: 'promptLibrary.templates' },
    { name: 'prompts/templates/[id]', titleKey: 'promptLibrary.editTemplate' },
    { name: 'prompts/templates/new', titleKey: 'promptLibrary.newTemplate' },
    { name: 'providers/[providerId]', titleKey: 'settingsProviders.title' },
    { name: 'providers/index', titleKey: 'settingsProviders.title' },
    { name: 'report-issue', titleKey: 'settings.reportIssue' },
    { name: 'secrets', titleKey: 'settings.secrets' },
    { name: 'server', titleKey: 'server.serverConfiguration' },
    { name: 'session', titleKey: 'settings.sessions' },
    { name: 'session/composer', titleKey: 'settingsSession.composer.title' },
    { name: 'session/handoff', titleKey: 'settingsSession.handoff.title' },
    { name: 'session/new-session-wizard', titleKey: 'settingsSession.sessionCreation.wizardDispositionTitle' },
    { name: 'session/permissions', titleKey: 'settingsSession.permissions.title' },
    { name: 'session/provider-limits', titleKey: 'settingsSession.providerLimits.title' },
    { name: 'session/resume', titleKey: 'settingsSession.resume.title' },
    { name: 'session/runtime', titleKey: 'settingsSession.runtime.title' },
    { name: 'session/tool-rendering', titleKey: 'settingsSession.toolRendering.title' },
    { name: 'session/transcript', titleKey: 'settingsSession.transcript.title' },
    { name: 'session/transcript/advanced', titleKey: 'settingsSession.transcript.advancedTitle' },
    { name: 'source-control', titleKey: 'navigation.sourceControl' },
    { name: 'sub-agent', titleKey: 'subAgentGuidance.settings.groupTitle' },
    { name: 'system-status', titleKey: 'settings.systemStatus' },
    { name: 'usage', titleKey: 'settings.usage' },
    { name: 'updates', titleKey: 'updates.title' },
    { name: 'voice', titleKey: 'settings.voiceAssistant' },
] as const;

export function getSettingsStackScreenDefinitions(
    t: Translate,
    scope: SettingsStackScope = 'settings',
): readonly SettingsStackScreenDefinition[] {
    const definitions: readonly SettingsRouteChromeDefinition[] = scope === 'prompts'
        ? SETTINGS_ROUTE_CHROME_DEFINITIONS.filter((definition) => definition.name.startsWith('prompts/'))
            .map((definition) => ({
                ...definition,
                name: definition.name.slice('prompts/'.length),
                parent: definition.parent?.replace(/^prompts\//, ''),
            }))
        : [
            ...SETTINGS_ROUTE_CHROME_DEFINITIONS.filter((definition) => !definition.name.startsWith('prompts/')),
            { name: 'prompts', headerShown: false },
        ];
    return definitions.map((definition) => {
        const options: NativeStackNavigationOptions = {
            headerShown: definition.headerShown ?? true,
            headerBackTitle: t(definition.headerBackTitleKey ?? 'common.back'),
        };
        if (!definition.titleKey) return { name: definition.name, options };
        const breadcrumbs = getSettingsBreadcrumbs(t, definition.name, definitions, scope);
        options.headerTitle = createSettingsBreadcrumbHeaderTitle(breadcrumbs);
        const routeOptions = settingsBreadcrumbsNeedRouteParams(breadcrumbs)
            ? (params: SettingsRouteParams) => ({ ...options, headerTitle: createSettingsBreadcrumbHeaderTitle(breadcrumbs, params) })
            : undefined;
        return {
            name: definition.name,
            options,
            breadcrumbs,
            ...(routeOptions ? { routeOptions } : {}),
        };
    });
}
