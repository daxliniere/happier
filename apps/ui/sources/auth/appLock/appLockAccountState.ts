import { z } from 'zod';

import { readAppLockStoredString, writeAppLockStoredString } from './appLockStorage';

/**
 * Whether the owner turned this device's app lock off. The account-wide lock turns itself on for every
 * device that signs in, so turning it off here is an exception for this device only; it stays that way
 * until the owner turns the lock on again from Settings.
 *
 * It is a plain local flag: it only stops the automatic turn-on and protects nothing by itself.
 */
const STATE_BASE_KEY = 'app_lock_account_v1';
const StoredStateSchema = z.object({ exempt: z.boolean() });

export type AppLockAccountState = Readonly<{ exempt: boolean }>;

let state: AppLockAccountState = Object.freeze({ exempt: false });

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
    if (parsed.success) state = parsed.data;
}

export function getAppLockAccountState(): AppLockAccountState {
    return state;
}

/** Marks this device as exempt (its lock was turned off by the owner) or clears that again. */
export async function setAppLockDeviceExempt(exempt: boolean): Promise<void> {
    state = { exempt };
    await writeAppLockStoredString(STATE_BASE_KEY, JSON.stringify(state));
}
