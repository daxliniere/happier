import { Platform } from 'react-native';

import {
    readNativeSecureStoreString,
    removeNativeSecureStoreString,
    writeNativeSecureStoreString,
} from '@/auth/storage/nativeSecureStoreWithDevFallback';
import { readStorageScopeFromEnv, scopedStorageId } from '@/utils/system/storageScope';

/**
 * Device-local storage for app-lock values: SecureStore on native, localStorage on web and desktop.
 * One owner for where they live, so the lock record and the account-lock state cannot drift apart.
 */
function storageKey(baseKey: string): string {
    return scopedStorageId(baseKey, readStorageScopeFromEnv());
}

export async function readAppLockStoredString(baseKey: string): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(storageKey(baseKey)) ?? null;
    return await readNativeSecureStoreString(storageKey(baseKey));
}

export async function writeAppLockStoredString(baseKey: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
        globalThis.localStorage.setItem(storageKey(baseKey), value);
        return;
    }
    await writeNativeSecureStoreString(storageKey(baseKey), value);
}

export async function removeAppLockStoredString(baseKey: string): Promise<void> {
    if (Platform.OS === 'web') {
        globalThis.localStorage?.removeItem(storageKey(baseKey));
        return;
    }
    await removeNativeSecureStoreString(storageKey(baseKey));
}
