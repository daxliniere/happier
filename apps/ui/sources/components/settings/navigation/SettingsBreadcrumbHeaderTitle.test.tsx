import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

import type { SettingsBreadcrumb } from './settingsRouteRegistry';
import { SettingsBreadcrumbHeaderTitle } from './SettingsBreadcrumbHeaderTitle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const routerState = vi.hoisted(() => ({ dismissTo: vi.fn() }));

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ router: { dismissTo: routerState.dismissTo } }).module;
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

const breadcrumbs: readonly SettingsBreadcrumb[] = [
    { title: 'Settings', href: '/settings' },
    { title: 'Connected services', href: '/settings/connected-services' },
    { title: 'Provider state sharing' },
];

describe('SettingsBreadcrumbHeaderTitle', () => {
    it('goes back up to the pressed level and leaves the current screen unlinked', async () => {
        const screen = await renderScreen(<SettingsBreadcrumbHeaderTitle breadcrumbs={breadcrumbs} />);

        screen.pressByTestId('settings-breadcrumb-1');
        expect(routerState.dismissTo).toHaveBeenCalledWith('/settings/connected-services');

        screen.pressByTestId('settings-breadcrumb-0');
        expect(routerState.dismissTo).toHaveBeenLastCalledWith('/settings');

        expect(screen.findByTestId('settings-breadcrumb-2')).toBeTruthy();
        expect(screen.findByTestId('settings-breadcrumb-2')?.props.onPress).toBeUndefined();
        expect(screen.getTextContent()).toContain('Provider state sharing');
    });
});
