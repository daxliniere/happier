import * as React from 'react';
import type { AccountProfile } from '@happier-dev/protocol';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import { useProviderUsageSources } from '@/hooks/server/connectedServices/useProviderUsageSources';
import {
    computeConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeWindowMode,
} from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { resolveConnectedServiceProfileLabel } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { useSetting } from '@/sync/domains/state/storage';
import { nowServerMs } from '@/sync/runtime/time';
import { useProviderUsageRecordIdsByAgent } from '@/sync/store/hooks';
import { t } from '@/text';

import { connectedServiceQuotaGaugeFormatter } from './connectedServiceQuotaGaugeFormatter';
import {
    resolveProviderUsageAccountIdentity,
    resolveProvisionalConnectedProfileKey,
    selectDistinctProviderUsageAccounts,
} from './providerUsageAccountIdentity';
import { resolveProviderUsageServiceIds } from './resolveDefaultProviderUsageProfileRef';

type AccountProfileConnectedService = AccountProfile['connectedServicesV2'][number];
type ConnectedProfileRef = Readonly<{ serviceId: string; profileId: string }>;

/** One provider account (a connected login or the native login) and its usage. */
export type ProviderUsageAccount = Readonly<{
    /** The account's identity (provider + login), stable when other accounts come and go. */
    key: string;
    agentId: AgentId;
    /** The connected login, or null for the provider's native login / an unidentified account. */
    profileRef: ConnectedProfileRef | null;
    /** "Claude", or "Claude 2" once the provider has more than one account. */
    label: string;
    gauge: ConnectedServiceQuotaGaugeViewModel | null;
}>;

export type ProviderUsageAccountRequest = Readonly<{
    key: string;
    agentId: AgentId;
    profileRef: ConnectedProfileRef | null;
    metadataRecordIds?: readonly string[];
    /** False for the placeholder entry of a provider with no account of its own. */
    identified: boolean;
    providerEmail?: string | null;
}>;

/**
 * A provider's own accounts, in display order: its connected logins in the order Settings shows
 * them (by profile id), then its native login. Only the provider's own usage services count, so
 * one provider never lists a login it can merely borrow from another.
 */
export function buildProviderUsageAccountRequests(params: Readonly<{
    agentIds: readonly AgentId[];
    connectedServices: ReadonlyArray<AccountProfileConnectedService>;
    nativeRecordIdsByAgent: ReadonlyMap<string, readonly string[]>;
}>): readonly ProviderUsageAccountRequest[] {
    const requests: ProviderUsageAccountRequest[] = [];
    for (const agentId of params.agentIds) {
        const own: ProviderUsageAccountRequest[] = [];
        for (const serviceId of resolveProviderUsageServiceIds(agentId)) {
            const service = params.connectedServices.find((candidate) => candidate.serviceId === serviceId);
            const profiles = [...(service?.profiles ?? [])]
                .map((profile) => ({ profile, profileId: profile.profileId.trim() }))
                .filter(({ profileId }) => profileId.length > 0)
                .sort((left, right) => left.profileId.localeCompare(right.profileId, undefined, { numeric: true }));
            for (const { profile, profileId } of profiles) {
                own.push({
                    key: `${agentId}:${serviceId}/${profileId}`,
                    agentId,
                    profileRef: { serviceId, profileId },
                    identified: true,
                    providerEmail: profile.providerEmail ?? null,
                });
            }
        }
        const nativeRecordIds = params.nativeRecordIdsByAgent.get(agentId);
        if (nativeRecordIds && nativeRecordIds.length > 0) {
            own.push({ key: `${agentId}:native`, agentId, profileRef: null, metadataRecordIds: nativeRecordIds, identified: true });
        }
        requests.push(...(own.length > 0 ? own : [{ key: `${agentId}:default`, agentId, profileRef: null, identified: false }]));
    }
    return requests;
}

function isSameProviderUsageAccount(left: ProviderUsageAccount, right: ProviderUsageAccount): boolean {
    return left.key === right.key
        && left.label === right.label
        && JSON.stringify(left.gauge) === JSON.stringify(right.gauge);
}

/**
 * Usage per provider account for surfaces that show every provider at once. Each account is listed
 * separately and numbered within its provider; a login that appears both as a connected profile and
 * as the native login (for example when the default account is that profile) is listed once.
 * Observation and account matching stay with useProviderUsageSources, shared with the composer.
 */
export function useProviderUsageAccounts(params: Readonly<{
    agentIds: readonly AgentId[];
    connectedServices: ReadonlyArray<AccountProfileConnectedService>;
    windowMode: ConnectedServiceQuotaGaugeWindowMode;
    fetchEnabled: boolean;
}>): readonly ProviderUsageAccount[] {
    const windowModes = useSetting('sessionProviderUsageGaugeWindowModes');
    const numberWindowMode = useSetting('sessionProviderUsageGaugeNumberWindowMode');
    const profileLabelByKey = useSetting('connectedServicesProfileLabelByKey');
    const nativeRecordIdsByAgent = useProviderUsageRecordIdsByAgent();
    const accountRequests = React.useMemo(() => buildProviderUsageAccountRequests({
        agentIds: params.agentIds,
        connectedServices: params.connectedServices,
        nativeRecordIdsByAgent,
    }), [params.agentIds, params.connectedServices, nativeRecordIdsByAgent]);
    const requests = React.useMemo(() => accountRequests.map((request) => ({
        providerId: request.agentId,
        profileRef: request.profileRef ? { ...request.profileRef, provenance: 'connected_binding_profile' as const } : null,
        metadataRecordIds: request.metadataRecordIds,
        nativeAccount: request.metadataRecordIds !== undefined,
    })), [accountRequests]);
    const resolved = useProviderUsageSources({
        requests,
        connectedServices: params.connectedServices,
        fetchEnabled: params.fetchEnabled,
    });

    const computedAccounts = React.useMemo(() => {
        const nowMs = nowServerMs();
        // The connected login each entry is: its own profile, or for the native entry, the profile a
        // provisional usage record was observed through.
        const connectedProfileKeyOf = (request: ProviderUsageAccountRequest, index: number): string | null => {
            if (request.profileRef) return `${request.profileRef.serviceId}/${request.profileRef.profileId}`;
            const source = resolved[index]?.displaySnapshotSource;
            return source?.kind === 'account_usage'
                ? resolveProvisionalConnectedProfileKey(source.accountUsageSnapshot.accountSubject)
                : null;
        };
        const configuredProfileKeys = new Set(accountRequests.flatMap((request) => (
            request.profileRef ? [`${request.profileRef.serviceId}/${request.profileRef.profileId}`] : []
        )));
        const listed = accountRequests
            .map((request, index) => ({ request, index }))
            .filter(({ request, index }) => {
                // A record of a connected login that no longer exists (for example a deleted profile)
                // is not a native login and has no account to show.
                const profileKey = request.profileRef ? null : connectedProfileKeyOf(request, index);
                if (profileKey && !configuredProfileKeys.has(profileKey)) return false;
                // A provider without an account of its own is only listed when it has figures anyway.
                return request.identified || (resolved[index]?.gaugeSource ?? null) !== null;
            });
        const distinct = selectDistinctProviderUsageAccounts(listed.map(({ request, index }) => ({
            agentId: request.agentId,
            identity: resolveProviderUsageAccountIdentity(
                resolved[index]?.displaySnapshotSource?.snapshot,
                connectedProfileKeyOf(request, index),
            ),
        }))).map((position) => listed[position]!);
        const countByAgent = new Map<AgentId, number>();
        for (const { request } of distinct) countByAgent.set(request.agentId, (countByAgent.get(request.agentId) ?? 0) + 1);
        const seenByAgent = new Map<AgentId, number>();
        return distinct.map(({ request, index }): ProviderUsageAccount => {
            const accountNumber = (seenByAgent.get(request.agentId) ?? 0) + 1;
            seenByAgent.set(request.agentId, accountNumber);
            const providerName = t(getAgentCore(request.agentId).displayNameKey);
            // The number only names the account once a provider has more than one.
            const label = (countByAgent.get(request.agentId) ?? 1) > 1 ? `${providerName} ${accountNumber}` : providerName;
            const gaugeSource = resolved[index]?.gaugeSource ?? null;
            const gauge = gaugeSource ? computeConnectedServiceQuotaGaugeViewModel({
                snapshot: gaugeSource.snapshot,
                windowMode: params.windowMode,
                windowModes,
                numberWindowMode,
                nowMs,
                formatter: connectedServiceQuotaGaugeFormatter,
                providerDisplayName: label,
                // Name the login so accounts of one provider can be told apart.
                activeAccountDisplayLabel: request.profileRef
                    ? request.providerEmail
                        ?? resolveConnectedServiceProfileLabel({
                            labelsByKey: profileLabelByKey,
                            serviceId: request.profileRef.serviceId,
                            profileId: request.profileRef.profileId,
                        })
                        ?? gaugeSource.snapshot.accountLabel
                        ?? request.profileRef.profileId
                    : gaugeSource.snapshot.accountLabel ?? null,
            }) : null;
            return { key: request.key, agentId: request.agentId, profileRef: request.profileRef, label, gauge };
        });
    }, [accountRequests, resolved, params.windowMode, windowModes, numberWindowMode, profileLabelByKey]);

    // Reuse each unchanged account by identity, so one account's update leaves the others' consumers alone.
    const previousAccountsRef = React.useRef<ReadonlyMap<string, ProviderUsageAccount>>(new Map());
    const accounts = React.useMemo(() => {
        const previous = previousAccountsRef.current;
        return computedAccounts.map((account) => {
            const prior = previous.get(account.key);
            return prior && isSameProviderUsageAccount(prior, account) ? prior : account;
        });
    }, [computedAccounts]);
    // The reuse baseline is the committed result only; a discarded render must not replace it.
    React.useEffect(() => {
        previousAccountsRef.current = new Map(accounts.map((account) => [account.key, account]));
    }, [accounts]);
    return accounts;
}
