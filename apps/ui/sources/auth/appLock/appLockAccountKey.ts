import { TokenStorage } from '@/auth/storage/tokenStorage';
import { deriveSettingsSecretsKeySet } from '@/sync/encryption/secretSettings';
import { resolveAccountScopedCryptoMaterialFromCredentials } from '@/sync/domains/connectedServices/resolveAccountScopedCryptoMaterialFromCredentials';

import { unwrapAppLockKey, wrapAppLockKey } from './appLockCrypto';

/**
 * The account-wide lock key wrapped under a key derived from the account's own secret, which every
 * signed-in device holds. This is how a device that signs in turns the lock on by itself, with no
 * password prompt. It needs the saved sign-in, so it is only available while the app is unlocked.
 */
async function readAccountKeys(): Promise<Readonly<{ writeKey: Uint8Array; readKeys: readonly Uint8Array[] }> | null> {
    const credentials = await TokenStorage.getCredentials();
    if (!credentials) return null;
    try {
        return deriveSettingsSecretsKeySet(resolveAccountScopedCryptoMaterialFromCredentials(credentials));
    } catch {
        return null;
    }
}

export async function wrapAppLockKeyForAccountDevices(dataKey: Uint8Array): Promise<string | null> {
    const keys = await readAccountKeys();
    return keys ? wrapAppLockKey(dataKey, keys.writeKey) : null;
}

export async function unwrapAppLockKeyForAccountDevices(deviceWrappedKey: string): Promise<Uint8Array | null> {
    const keys = await readAccountKeys();
    if (!keys) return null;
    for (const key of keys.readKeys) {
        const dataKey = unwrapAppLockKey(deviceWrappedKey, key);
        if (dataKey) return dataKey;
    }
    return null;
}
