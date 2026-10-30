import * as React from 'react';

import { ConnectedServiceIdSchema } from '@happier-dev/protocol';

import { useAuth } from '@/auth/context/AuthContext';
import { resolveAuthCredentialsScopeKey } from '@/auth/storage/resolveAuthCredentialsScopeKey';
import type { AuthCredentials } from '@/auth/storage/tokenStorage';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { refreshProviderAccountUsage } from '@/sync/domains/connectedServices/accountUsage/refreshProviderAccountUsage';
import { collectConfiguredProviderUsageRefreshTargets, type ProviderUsageRefreshTarget } from '@/sync/domains/connectedServices/accountUsage/providerUsageRefreshTargets';
import { connectedServiceProfileKey } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { useProfile } from '@/sync/domains/state/storage';
import { useAllSessions } from '@/sync/store/hooks';
import {
    buildQuotaSnapshotScopeKey,
    refreshQuotaSnapshot,
    type CredentialScopedAccountMode,
} from '@/sync/domains/connectedServices/connectedServiceQuotaSnapshotStore';
import { fireAndForget } from '@/utils/system/fireAndForget';

import { useCredentialScopedAccountModeResolver } from './useCredentialScopedAccountModeResolver';

export type { ProviderUsageRefreshTarget } from '@/sync/domains/connectedServices/accountUsage/providerUsageRefreshTargets';

export type ProviderUsageRefreshContext = Readonly<{
    credentials: AuthCredentials;
    credentialScope: string;
    resolveAccountMode: () => Promise<CredentialScopedAccountMode>;
    configuredTargets?: readonly ProviderUsageRefreshTarget[];
}>;

/** The signed-in scope and configured usage sources, or null when quotas are off or nobody is signed in. */
export function useProviderUsageRefreshContext(): ProviderUsageRefreshContext | null {
    const credentials = useAuth().credentials;
    const quotasEnabled = useFeatureEnabled('connectedServices.quotas');
    const credentialScope = quotasEnabled && credentials ? resolveAuthCredentialsScopeKey(credentials) : '';
    const resolveAccountMode = useCredentialScopedAccountModeResolver({ credentials, credentialScope });
    const connectedServices = useProfile()?.connectedServicesV2;
    const sessions = useAllSessions();
    const configuredTargets = React.useMemo(() => collectConfiguredProviderUsageRefreshTargets({
        connectedServices: connectedServices ?? [], sessions,
    }), [connectedServices, sessions]);
    return React.useMemo(
        () => (credentials && credentialScope ? { credentials, credentialScope, resolveAccountMode, configuredTargets } : null),
        [credentialScope, credentials, resolveAccountMode, configuredTargets],
    );
}

/**
 * "Query the provider now" includes all configured providers: refreshes connected-service quota profiles and
 * each provider account usage record it reads from. Both routes ask the server to have the
 * owning daemon re-query the provider; the new figures arrive through the usual snapshot caches.
 */
export function runProviderUsageRefresh(context: ProviderUsageRefreshContext, target: ProviderUsageRefreshTarget): void {
    const profiles = new Map<string, NonNullable<ProviderUsageRefreshTarget['connectedProfileRef']>>();
    const recordIds = new Set<string>();
    for (const candidate of [target, ...(context.configuredTargets ?? [])]) {
        if (candidate.connectedProfileRef) profiles.set(connectedServiceProfileKey(candidate.connectedProfileRef), candidate.connectedProfileRef);
        for (const recordId of candidate.recordIds) recordIds.add(recordId);
    }
    for (const connectedProfileRef of profiles.values()) {
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
    for (const recordId of recordIds) {
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

/** A stable refresh-all press handler, retaining the surface's explicit account as an additional target. */
export function useProviderUsageRefresh(target: ProviderUsageRefreshTarget): () => void {
    const context = useProviderUsageRefreshContext();
    const { connectedProfileRef, recordIds } = target;
    return React.useCallback(() => {
        if (context) runProviderUsageRefresh(context, { connectedProfileRef, recordIds });
    }, [connectedProfileRef, context, recordIds]);
}
