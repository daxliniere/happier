import * as React from 'react';
import { AppState } from 'react-native';

import { syncAppLockAccountLock } from '@/auth/appLock/appLockAccountSync';
import { useAppLockSnapshot } from '@/auth/appLock/appLockRuntime';

/**
 * Keeps this device in step with the account-wide lock while signed in: once when the app has
 * started (and whenever this device's lock turns on or off) and each time it returns to the
 * foreground. Renders nothing; there is no timer, so nothing keeps running while the app is hidden.
 */
export function AppLockAccountSyncRuntime(props: Readonly<{ enabled: boolean }>): null {
    const { status } = useAppLockSnapshot();
    const ready = props.enabled && status !== 'loading';

    React.useEffect(() => {
        if (!ready) return;
        const run = () => {
            void syncAppLockAccountLock().catch((error: unknown) => {
                console.error('[appLock] Account lock sync failed:', error instanceof Error ? error.message : String(error));
            });
        };
        run();
        const subscription = AppState.addEventListener('change', (next) => {
            if (next === 'active') run();
        });
        return () => subscription.remove();
    }, [ready, status]);

    return null;
}
