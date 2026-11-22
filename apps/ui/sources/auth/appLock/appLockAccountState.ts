import * as React from 'react';
import { z } from 'zod';

import { readAppLockStoredString, writeAppLockStoredString } from './appLockStorage';
import type { AppLockStatus } from './appLockRuntime';

/**
 * Device-local view of the account-wide lock: whether the account requires the lock on every device
 * (last value the relay reported) and whether this device was exempted by turning its lock off.
 *
 * Both are plain flags. They only decide whether a device that has no lock of its own shows the gate
 * screen; the protection of a device that does have a lock is its sealed sign-in, not these flags.
 */
const STATE_BASE_KEY = 'app_lock_account_v1';
const StoredStateSchema = z.object({ required: z.boolean(), exempt: z.boolean() });

export type AppLockAccountState = Readonly<{ required: boolean; exempt: boolean }>;

const DEFAULT_STATE: AppLockAccountState = Object.freeze({ required: false, exempt: false });

let state: AppLockAccountState = DEFAULT_STATE;
const listeners = new Set<() => void>();

function setState(next: AppLockAccountState): void {
    if (next.required === state.required && next.exempt === state.exempt) return;
    state = next;
    for (const listener of listeners) listener();
}

async function persist(next: AppLockAccountState): Promise<void> {
    setState(next);
    await writeAppLockStoredString(STATE_BASE_KEY, JSON.stringify(next));
}

export async function loadAppLockAccountState(): Promise<void> {
    const raw = await readAppLockStoredString(STATE_BASE_KEY);
    if (!raw) return;
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        json = null;
    }
    const parsed = StoredStateSchema.safeParse(json);
    if (parsed.success) setState(parsed.data);
}

export function getAppLockAccountState(): AppLockAccountState {
    return state;
}

export function subscribeAppLockAccountState(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function useAppLockAccountState(): AppLockAccountState {
    return React.useSyncExternalStore(subscribeAppLockAccountState, getAppLockAccountState, getAppLockAccountState);
}

/** Records what the relay last said about whether the account requires the lock on every device. */
export async function setAppLockAccountRequired(required: boolean): Promise<void> {
    await persist({ ...state, required });
}

/** Marks this device as exempt (its lock was turned off by the owner) or clears that again. */
export async function setAppLockDeviceExempt(exempt: boolean): Promise<void> {
    await persist({ ...state, exempt });
}

/**
 * Whether a signed-in device must show the gate: the account requires the lock, this device has none
 * and was not exempted. A signed-out device never shows it, so sign-in is never blocked.
 */
export function appLockAccountGateActive(params: Readonly<{ lockStatus: AppLockStatus; signedIn: boolean }>): boolean {
    return params.signedIn && params.lockStatus === 'disabled' && state.required && !state.exempt;
}
