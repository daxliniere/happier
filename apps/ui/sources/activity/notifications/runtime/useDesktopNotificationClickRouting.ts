import { router } from 'expo-router';
import * as React from 'react';

import { navigateToSessionRoute } from '@/hooks/session/navigateToSessionRoute';
import { invokeTauri, isTauriDesktop, listenTauriEvent } from '@/utils/platform/tauri';

export const DESKTOP_NOTIFICATION_CLICKED_EVENT = 'desktop-notification-clicked';

const TAKE_PENDING_COMMAND = 'desktop_take_pending_notification_session';

/**
 * Opens the session a clicked desktop toast was about (the shell has already focused the window).
 *
 * The shell's pending slot owns the click; the event only wakes the consumer. Startup and live
 * wakes take the same take-once slot, one at a time, so a click opens exactly once and a click
 * made while the listener was still registering (or after registering failed) is not lost.
 */
export function useDesktopNotificationClickRouting(): void {
    React.useEffect(() => {
        if (!isTauriDesktop()) return;

        let disposed = false;
        let unlisten: (() => void) | null = null;
        let queue: Promise<void> = Promise.resolve();

        const takePending = async (): Promise<void> => {
            if (disposed) return;
            try {
                const pending = await invokeTauri<string | null>(TAKE_PENDING_COMMAND);
                const sessionId = typeof pending === 'string' ? pending.trim() : '';
                if (!disposed && sessionId) {
                    navigateToSessionRoute({ router, sessionId });
                }
            } catch (error) {
                console.warn('[notifications] Desktop notification click unavailable', error);
            }
        };
        // Serialised so overlapping wakes cannot interleave; the newest click is taken last.
        const wake = () => {
            queue = queue.then(takePending);
        };

        void listenTauriEvent<unknown>(DESKTOP_NOTIFICATION_CLICKED_EVENT, wake)
            .then((dispose) => {
                if (disposed) {
                    dispose();
                    return;
                }
                unlisten = dispose;
            })
            .catch((error) => {
                console.warn('[notifications] Desktop notification click listener unavailable', error);
            })
            // Settle registration first. The slot stays readable even if listening failed.
            .then(wake);

        return () => {
            disposed = true;
            unlisten?.();
        };
    }, []);
}
