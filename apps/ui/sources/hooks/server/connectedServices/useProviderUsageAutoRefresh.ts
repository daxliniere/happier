import * as React from 'react';

import { useSetting } from '@/sync/domains/state/storage';

import { runProviderUsageRefresh, useProviderUsageRefreshContext, type ProviderUsageRefreshContext } from './useProviderUsageRefresh';

const DEFAULT_AUTO_REFRESH_MINUTES = 5;
/** Smallest interval honoured, so a mistyped value cannot hammer the server. */
const MIN_AUTO_REFRESH_MINUTES = 1;

/** Reads the `providerUsageAutoRefreshMinutes` setting: a positive number of minutes, else the default. */
export function resolveProviderUsageAutoRefreshMs(minutes: unknown): number {
    const parsed = typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_AUTO_REFRESH_MINUTES;
    return Math.max(MIN_AUTO_REFRESH_MINUTES, parsed) * 60_000;
}

type Registration = Readonly<{ context: ProviderUsageRefreshContext; intervalMs: number }>;

// One shared timer: any number of mounted surfaces register, but only one refresh runs per tick.
const registrations = new Set<{ current: Registration }>();
let timer: ReturnType<typeof setInterval> | null = null;
let timerIntervalMs = 0;

function syncTimer(): void {
    const latest = [...registrations].at(-1)?.current ?? null;
    if (!latest) {
        if (timer) clearInterval(timer);
        timer = null;
        timerIntervalMs = 0;
        return;
    }
    if (timer && timerIntervalMs === latest.intervalMs) return;
    if (timer) clearInterval(timer);
    timerIntervalMs = latest.intervalMs;
    timer = setInterval(() => {
        const current = [...registrations].at(-1)?.current;
        if (current) runProviderUsageRefresh(current.context, { connectedProfileRef: null, recordIds: [] });
    }, latest.intervalMs);
}

/**
 * Re-queries every configured provider on the Usage-settings interval, for as long as any surface
 * using this hook is mounted; the timer stops when the last one unmounts.
 */
export function useProviderUsageAutoRefresh(): void {
    const context = useProviderUsageRefreshContext();
    const intervalMs = resolveProviderUsageAutoRefreshMs(useSetting('providerUsageAutoRefreshMinutes'));
    const registration = React.useRef<Registration | null>(null) as React.MutableRefObject<Registration>;
    if (context) registration.current = { context, intervalMs };
    const signedIn = context !== null;
    React.useEffect(() => {
        if (!signedIn) return;
        registrations.add(registration);
        syncTimer();
        return () => {
            registrations.delete(registration);
            syncTimer();
        };
    }, [signedIn]);
    React.useEffect(() => { syncTimer(); }, [intervalMs]);
}
