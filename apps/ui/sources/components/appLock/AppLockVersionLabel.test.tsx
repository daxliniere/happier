import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';

// The app runtime info reads native modules, which is the system boundary here.
const runtime = vi.hoisted(() => ({ appVersion: '0.2.21-beta1.2 (beta1)' as string | null }));
vi.mock('@/sync/runtime/readCurrentAppRuntimeInfo', () => ({
    readCurrentAppRuntimeInfo: () => ({ appVersion: runtime.appVersion }),
}));

describe('AppLockVersionLabel', () => {
    beforeEach(() => {
        runtime.appVersion = '0.2.21-beta1.2 (beta1)';
    });

    it('shows the running app version', async () => {
        const { AppLockVersionLabel } = await import('./AppLockVersionLabel');
        const screen = await renderScreen(<AppLockVersionLabel />);
        expect(screen.tree.findByProps({ testID: 'app-lock-version' }).props.children).toBe('0.2.21-beta1.2 (beta1)');
    });

    it('shows nothing when the version is unknown', async () => {
        runtime.appVersion = null;
        const { AppLockVersionLabel } = await import('./AppLockVersionLabel');
        const screen = await renderScreen(<AppLockVersionLabel />);
        expect(screen.tree.findAll((node) => node.props?.testID === 'app-lock-version')).toHaveLength(0);
    });
});
