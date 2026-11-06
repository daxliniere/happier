import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_LOCK_RECOVERY_ROUTES } from '@happier-dev/protocol';

import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from '../settingsViewTestHelpers';

const boundary = vi.hoisted(() => ({
    serverFetch: vi.fn(),
    prompt: vi.fn(async () => null),
    alert: vi.fn(),
}));

installSettingsViewCommonModuleMocks({
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: boundary }).module;
    },
});
// Keep the screen, app-lock state, validation and API adapter real below HTTP/native boundaries.
vi.mock('@/sync/http/client', () => ({ serverFetch: boundary.serverFetch }));
vi.mock('@/sync/domains/state/storageStore', async () => {
    const { createReactiveStorageStoreMock } = await import('@/dev/testkit/mocks/storage');
    const { localSettingsDefaults } = await import('@/sync/domains/settings/localSettings');
    const { settingsDefaults } = await import('@/sync/domains/settings/settings');
    const storage = createReactiveStorageStoreMock({ settings: settingsDefaults, localSettings: localSettingsDefaults });
    return { storage, getStorage: () => storage };
});

const savedMail = {
    recoveryEmail: 'recipient@example.com',
    host: 'smtp.example.com', port: 587, security: 'starttls', username: 'smtp-user',
    fromAddress: 'sender@example.com', hasPassword: true,
};

const { AppLockSettingsView } = await import('./AppLockSettingsView');

describe('App lock test email recipient', () => {
    beforeEach(async () => {
        vi.stubGlobal('BroadcastChannel', undefined);
        boundary.prompt.mockClear();
        boundary.alert.mockClear();
        boundary.serverFetch.mockReset();
        boundary.serverFetch.mockImplementation(async (path: string) => {
            if (path === '/v1/features') return Response.json({ features: {
                appLock: { emailRecovery: { enabled: true } },
            } });
            if (path === APP_LOCK_RECOVERY_ROUTES.mailSettings) {
                return Response.json({ settings: savedMail });
            }
            if (path === APP_LOCK_RECOVERY_ROUTES.mailSettingsTest) return Response.json({ ok: true });
            throw new Error(`Unexpected request: ${path}`);
        });
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ features: {
            appLock: { emailRecovery: { enabled: true } },
        } })));
        const { deactivateAppLock } = await import('@/auth/appLock/appLockRuntime');
        await deactivateAppLock();
    });

    it('uses the saved account-wide recovery recipient without prompting or sending to the SMTP sender', async () => {
        const screen = await renderScreen(<AppLockSettingsView />);
        await screen.pressByTestIdAsync('app-lock-mail-test');
        expect(boundary.prompt).not.toHaveBeenCalled();
        expect(boundary.serverFetch).toHaveBeenCalledWith(APP_LOCK_RECOVERY_ROUTES.mailSettingsTest,
            expect.objectContaining({ body: JSON.stringify({}) }), {});
    });

    it('keeps the test button visible and disabled without a saved valid recipient', async () => {
        boundary.serverFetch.mockImplementation(async (path: string) => {
            if (path === '/v1/features') return Response.json({ features: { appLock: { emailRecovery: { enabled: true } } } });
            if (path === APP_LOCK_RECOVERY_ROUTES.mailSettings) return Response.json({ settings: { ...savedMail, recoveryEmail: null } });
            throw new Error(`Unexpected request: ${path}`);
        });
        const screen = await renderScreen(<AppLockSettingsView />);
        expect(screen.findByTestId('app-lock-mail-test')?.props.disabled).toBe(true);
        expect(screen.findByTestId('app-lock-settings-email')).not.toBeNull();
    });

    it('sends Test Email with no recipient body; the server uses its shared saved address', async () => {
        const screen = await renderScreen(<AppLockSettingsView />);
        await screen.pressByTestIdAsync('app-lock-mail-test');
        expect(boundary.serverFetch).toHaveBeenCalledWith(APP_LOCK_RECOVERY_ROUTES.mailSettingsTest,
            expect.objectContaining({ body: JSON.stringify({}) }), {});
        expect(boundary.prompt).not.toHaveBeenCalled();
    });

    it('saves the recovery address with the account-wide mail settings', async () => {
        const screen = await renderScreen(<AppLockSettingsView />);
        await act(async () => {
            screen.changeTextByTestId('app-lock-settings-email', 'new-recipient@example.net');
        });
        await screen.pressByTestIdAsync('app-lock-mail-save');
        expect(boundary.serverFetch).toHaveBeenCalledWith(APP_LOCK_RECOVERY_ROUTES.mailSettings,
            expect.objectContaining({
                method: 'PUT',
                body: expect.stringContaining('"recoveryEmail":"new-recipient@example.net"'),
            }), {});
    });

    it('keeps Test Email disabled until server settings have been saved, even with a valid recipient', async () => {
        boundary.serverFetch.mockImplementation(async (path: string) => {
            if (path === APP_LOCK_RECOVERY_ROUTES.mailSettings) return Response.json({ settings: null });
            throw new Error(`Unexpected request: ${path}`);
        });
        const screen = await renderScreen(<AppLockSettingsView />);
        expect(screen.findByTestId('app-lock-mail-test')?.props.disabled).toBe(true);
    });
});
