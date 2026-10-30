import * as React from 'react';

import { ConnectedServiceIdSchema } from '@happier-dev/protocol';

import { useAuth } from '@/auth/context/AuthContext';
import { resolveAuthCredentialsScopeKey } from '@/auth/storage/resolveAuthCredentialsScopeKey';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { refreshProviderAccountUsage } from '@/sync/domains/connectedServices/accountUsage/refreshProviderAccountUsage';
import {
    buildQuotaSnapshotScopeKey,
    refreshQuotaSnapshot,
    type CredentialScopedAccountMode,
} from '@/sync/domains/connectedServices/connectedServiceQuotaSnapshotStore';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { useCredentialScopedAccountModeResolver } from './useCredentialScopedAccountModeResolver';

export type ProviderUsageRefreshTarget = Readonly<{
    connectedProfileRef: Readonly<{ serviceId: string; profileId: string }> | null;
    recordIds: readonly string[];
}>;

export type ProviderUsageRefreshContext = Readonly<{
    credentials: AuthCredentials;
    credentialScope: string;
    resolveAccountMode: () => Promise<CredentialScopedAccountMode>;
}>;

/** The auth facts a refresh needs, or null when quotas are off or nobody is signed in. */
export function useProviderUsageRefreshContext(): ProviderUsageRefreshContext | null {
    const credentials = useAuth().credentials;
    const quotasEnabled = useFeatureEnabled('connectedServices.quotas');
    const credentialScope = quotasEnabled && credentials ? resolveAuthCredentialsScopeKey(credentials) : '';
    const resolveAccountMode = useCredentialScopedAccountModeResolver({ credentials, credentialScope });
    return React.useMemo(
        () => (credentials && credentialScope ? { credentials, credentialScope, resolveAccountMode } : null),
        [credentialScope, credentials, resolveAccountMode],
    );
}

/**
 * "Query the provider now" for one provider: refreshes its connected-service quota profile and
 * each provider account usage record it reads from. Both routes ask the server to have the
 * owning daemon re-query the provider; the new figures arrive through the usual snapshot caches.
 */
export function runProviderUsageRefresh(context: ProviderUsageRefreshContext, target: ProviderUsageRefreshTarget): void {
    const { connectedProfileRef } = target;
    if (connectedProfileRef) {
        const serviceId = ConnectedServiceIdSchema.safeParse(connectedProfileRef.serviceId);
        if (serviceId.success) {
            fireAndForget(
                refreshQuotaSnapshot(
                    buildQuotaSnapshotScopeKey(context.credentialScope, serviceId.data, connectedProfileRef.profileId),
                    {
                        credentials: context.credentials,
                        credentialScope: context.credentialScope,
                        serviceId: serviceId.data,
                        profileId: connectedProfileRef.profileId,
                        resolveAccountMode: context.resolveAccountMode,
                    },
                ),
                { tag: 'runProviderUsageRefresh.connectedService' },
            );
        }
    }
    for (const recordId of target.recordIds) {
        fireAndForget((async () => {
            await refreshProviderAccountUsage({
                credentials: context.credentials,
                credentialScope: context.credentialScope,
                recordId,
                mode: await context.resolveAccountMode(),
            });
        })(), { tag: 'runProviderUsageRefresh.accountUsage' });
    }
}

/** A stable press handler for a surface that owns a single provider's refresh target. */
export function useProviderUsageRefresh(target: ProviderUsageRefreshTarget): () => void {
    const context = useProviderUsageRefreshContext();
    const { connectedProfileRef, recordIds } = target;
    return React.useCallback(() => {
        if (context) runProviderUsageRefresh(context, { connectedProfileRef, recordIds });
    }, [connectedProfileRef, context, recordIds]);
}
