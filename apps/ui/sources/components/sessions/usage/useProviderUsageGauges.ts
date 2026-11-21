import * as React from 'react';
import type { AccountProfile } from '@happier-dev/protocol';

import { getAgentCore, type AgentId } from '@/agents/catalog/catalog';
import { connectedServiceQuotaGaugeFormatter } from '@/components/sessions/usage/connectedServiceQuotaGaugeFormatter';
import { useProviderUsageSources } from '@/hooks/server/connectedServices/useProviderUsageSources';
import { runProviderUsageRefresh, useProviderUsageRefreshContext } from '@/hooks/server/connectedServices/useProviderUsageRefresh';
import {
    computeConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeWindowMode,
} from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { nowServerMs } from '@/sync/runtime/time';
import { useSetting } from '@/sync/domains/state/storage';
import { useLatestProviderUsageRecordIdsByAgent, useLatestProviderUsageRuntimeIssuesByAgent } from '@/sync/store/hooks';
import { t } from '@/text';

import { resolveProviderUsageAccountIdentity, selectDistinctProviderUsageAccounts } from './providerUsageAccountIdentity';
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
    /** 1-based position among this provider's accounts, in display order. */
    accountNumber: number;
    accountCount: number;
    /** "Claude", or "Claude 2" once the provider has more than one account. */
    label: string;
    gauge: ConnectedServiceQuotaGaugeViewModel | null;
}>;

type AccountRequest = Readonly<{
    key: string;
    agentId: AgentId;
    profileRef: ConnectedProfileRef | null;
    metadataRecordIds?: readonly string[];
    /** False for the placeholder entry of a provider with no account of its own. */
    identified: boolean;
}>;

/** A provider's own accounts, in display order: its connected logins as listed, then its native login. */
function buildAccountRequests(params: Readonly<{
    agentIds: readonly AgentId[];
    connectedServices: ReadonlyArray<AccountProfileConnectedService>;
    nativeRecordIdsByAgent: ReadonlyMap<AgentId, readonly string[]>;
}>): readonly AccountRequest[] {
    const requests: AccountRequest[] = [];
    for (const agentId of params.agentIds) {
        const own: AccountRequest[] = [];
        for (const serviceId of resolveProviderUsageServiceIds(agentId)) {
            const service = params.connectedServices.find((candidate) => candidate.serviceId === serviceId);
            for (const profile of service?.profiles ?? []) {
                const profileId = profile.profileId.trim();
                if (!profileId) continue;
                own.push({ key: `${agentId}:${serviceId}/${profileId}`, agentId, profileRef: { serviceId, profileId }, identified: true });
            }
        }
        const nativeRecordIds = params.nativeRecordIdsByAgent.get(agentId);
        if (nativeRecordIds && nativeRecordIds.length > 0) {
            own.push({ key: `${agentId}:native`, agentId, profileRef: null, metadataRecordIds: nativeRecordIds, identified: true });
        }
        // A provider with no identified account still gets one entry, so a runtime limit report
        // or an unavailable state remains visible for it.
        requests.push(...(own.length > 0 ? own : [{ key: `${agentId}:default`, agentId, profileRef: null, identified: false }]));
    }
    return requests;
}

function isSameProviderUsageAccount(left: ProviderUsageAccount, right: ProviderUsageAccount): boolean {
    return left.key === right.key
        && left.accountNumber === right.accountNumber
        && left.accountCount === right.accountCount
        && left.label === right.label
        && JSON.stringify(left.gauge) === JSON.stringify(right.gauge);
}

/**
 * Usage per provider account, for surfaces that show every configured provider at once (the
 * sessions pane header and the Agent picker rail). Each account is listed separately; one
 * provider's login is never shown as another provider's usage.
 *
 * All observations and account matching are owned by useProviderUsageSources, shared
 * with both composers. This hook only projects gauges and configuration for the rail/HUD.
 */
export function useProviderUsageGauges(params: Readonly<{
    agentIds: readonly AgentId[];
    accountProfileConnectedServicesV2: ReadonlyArray<AccountProfileConnectedService>;
    windowMode: ConnectedServiceQuotaGaugeWindowMode;
    /** Usage is only fetched while a surface wants it; until then only cached values render. */
    fetchEnabled: boolean;
}>): Readonly<{
    /** Every account, grouped by provider in `agentIds` order and numbered within each provider. */
    accounts: readonly ProviderUsageAccount[];
    /** The first account's gauge per provider, for single-entry surfaces such as the picker rail. */
    gauges: ReadonlyMap<AgentId, ConnectedServiceQuotaGaugeViewModel>;
    /** Configured profiles or native logins remain present even when credential health prevents querying. */
    configuredAgentIds: ReadonlySet<AgentId>;
    /** Queries every configured provider, including this Agent's displayed account. */
    refreshAgent: (agentId: AgentId) => void;
}> {
    const windowModes = useSetting('sessionProviderUsageGaugeWindowModes');
    const numberWindowMode = useSetting('sessionProviderUsageGaugeNumberWindowMode');
    const latestRecordIdsByAgent = useLatestProviderUsageRecordIdsByAgent();
    const latestRuntimeIssuesByAgent = useLatestProviderUsageRuntimeIssuesByAgent();
    const accountRequests = React.useMemo(() => buildAccountRequests({
        agentIds: params.agentIds,
        connectedServices: params.accountProfileConnectedServicesV2,
        nativeRecordIdsByAgent: latestRecordIdsByAgent,
    }), [params.agentIds, params.accountProfileConnectedServicesV2, latestRecordIdsByAgent]);
    const requests = React.useMemo(() => accountRequests.map((request) => ({
        providerId: request.agentId,
        profileRef: request.profileRef ? { ...request.profileRef, provenance: 'connected_binding_profile' as const } : null,
        metadataRecordIds: request.metadataRecordIds,
        nativeAccount: request.metadataRecordIds !== undefined,
    })), [accountRequests]);
    const resolved = useProviderUsageSources({
        requests,
        connectedServices: params.accountProfileConnectedServicesV2,
        fetchEnabled: params.fetchEnabled,
    });

    const refreshContext = useProviderUsageRefreshContext();
    const refreshAgent = React.useCallback((agentId: AgentId) => {
        if (!refreshContext) return;
        const request = accountRequests.find((candidate) => candidate.agentId === agentId);
        runProviderUsageRefresh(refreshContext, {
            connectedProfileRef: request?.profileRef ?? null,
            recordIds: latestRecordIdsByAgent.get(agentId) ?? [],
        });
    }, [accountRequests, latestRecordIdsByAgent, refreshContext]);

    const previousAccountsRef = React.useRef<ReadonlyMap<string, ProviderUsageAccount>>(new Map());
    const computedAccounts = React.useMemo(() => {
        const nowMs = nowServerMs();
        // A provider without an identified account is only listed when it has evidence of its own:
        // figures, a limit report, or sessions that used it.
        const listed = accountRequests.map((request, index) => ({ request, index })).filter(({ request, index }) => (
            request.identified
            || (resolved[index]?.gaugeSource ?? null) !== null
            || latestRuntimeIssuesByAgent.has(request.agentId)
            || latestRecordIdsByAgent.has(request.agentId)
        ));
        // One entry per login: a native login that is the same person as a connected profile (for
        // example when the default account is that profile) would otherwise show its usage twice.
        const distinct = selectDistinctProviderUsageAccounts(listed.map(({ request, index }) => ({
            agentId: request.agentId,
            identity: resolveProviderUsageAccountIdentity(resolved[index]?.displaySnapshotSource?.snapshot),
        }))).map((position) => listed[position]!);
        const countByAgent = new Map<AgentId, number>();
        for (const { request } of distinct) countByAgent.set(request.agentId, (countByAgent.get(request.agentId) ?? 0) + 1);
        const seenByAgent = new Map<AgentId, number>();
        return distinct.map(({ request, index }): ProviderUsageAccount => {
            const accountNumber = (seenByAgent.get(request.agentId) ?? 0) + 1;
            seenByAgent.set(request.agentId, accountNumber);
            const accountCount = countByAgent.get(request.agentId) ?? 1;
            const providerName = t(getAgentCore(request.agentId).displayNameKey);
            // The number only names the account once a provider has more than one.
            const label = accountCount > 1 ? `${providerName} ${accountNumber}` : providerName;
            const gaugeSource = resolved[index]?.gaugeSource ?? null;
            const gauge = gaugeSource ? computeConnectedServiceQuotaGaugeViewModel({
                snapshot: gaugeSource.snapshot,
                windowMode: params.windowMode,
                windowModes,
                numberWindowMode,
                nowMs,
                formatter: connectedServiceQuotaGaugeFormatter,
                providerDisplayName: label,
            }) : null;
            return { key: request.key, agentId: request.agentId, profileRef: request.profileRef, accountNumber, accountCount, label, gauge };
        });
    }, [accountRequests, resolved, params.windowMode, windowModes, numberWindowMode, latestRuntimeIssuesByAgent, latestRecordIdsByAgent]);
    // Reuse each unchanged account (and its gauge) by identity, so one account's update does not
    // re-render every other account's consumers.
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

    const previousGaugesRef = React.useRef<ReadonlyMap<AgentId, ConnectedServiceQuotaGaugeViewModel>>(new Map());
    const gauges = React.useMemo(() => {
        const byAgent = new Map<AgentId, ConnectedServiceQuotaGaugeViewModel>();
        for (const account of accounts) {
            if (account.gauge && !byAgent.has(account.agentId)) byAgent.set(account.agentId, account.gauge);
        }
        const previous = previousGaugesRef.current;
        const unchanged = previous.size === byAgent.size
            && [...byAgent].every(([agentId, gauge]) => previous.get(agentId) === gauge);
        return unchanged ? previous : byAgent;
    }, [accounts]);
    React.useEffect(() => {
        previousGaugesRef.current = gauges;
    }, [gauges]);

    const configuredAgentIds = React.useMemo(() => new Set(
        params.agentIds.filter((agentId) => (
            // Configuration and query eligibility are different facts. A refresh/reconnect status
            // must not remove a saved provider from the HUD while its figures are unavailable.
            resolveProviderUsageServiceIds(agentId).some((serviceId) => (
                params.accountProfileConnectedServicesV2.some((service) => service.serviceId === serviceId
                    && service.profiles.some((profile) => profile.profileId.trim().length > 0))
            ))
            || latestRecordIdsByAgent.has(agentId)
            || latestRuntimeIssuesByAgent.has(agentId)
            || gauges.has(agentId)
        )),
    ), [params.agentIds, params.accountProfileConnectedServicesV2, latestRecordIdsByAgent, latestRuntimeIssuesByAgent, gauges]);
    return React.useMemo(() => ({ accounts, gauges, configuredAgentIds, refreshAgent }), [accounts, gauges, configuredAgentIds, refreshAgent]);
}
