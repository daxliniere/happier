import { invokeTauri } from '@/utils/platform/tauri';

import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from './tauriNotificationPlugin';

/**
 * Asks the desktop shell to show a toast that reports clicks (Windows only; the notification
 * plugin has no click callback on desktop). Resolves false where the shell does not do this.
 */
async function showClickableDesktopNotification(params: Readonly<{
    title: string;
    body: string;
    sessionId?: string;
}>): Promise<boolean> {
    try {
        return (await invokeTauri<boolean>('desktop_show_clickable_notification', {
            title: params.title,
            body: params.body,
            sessionId: params.sessionId ?? null,
        })) === true;
    } catch (error) {
        // Fall back to the plain toast (its click opens nothing), but say why.
        console.warn('[notifications] Clickable desktop notification unavailable', error);
        return false;
    }
}

export async function sendTauriLocalNotification(params: Readonly<{
    title: string;
    body: string;
    sessionId?: string;
}>): Promise<boolean> {
    let granted = await isPermissionGranted();
    if (!granted) {
        granted = (await requestPermission()) === 'granted';
    }
    if (!granted) {
        return false;
    }

    if (await showClickableDesktopNotification(params)) {
        return true;
    }

    await sendNotification({
        title: params.title,
        body: params.body,
    });
    return true;
}
