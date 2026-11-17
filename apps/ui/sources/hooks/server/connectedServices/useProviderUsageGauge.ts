import * as React from 'react';

import {
    ConnectedServiceIdSchema,
    type ConnectedServiceQuotaRecoveryCreditsV1,
} from '@happier-dev/protocol';

import { resolveConnectedServiceDisplayName } from '@/components/settings/connectedServices/model/resolveConnectedServiceDisplayName';
import { connectedServiceQuotaGaugeFormatter } from '@/components/sessions/usage/connectedServiceQuotaGaugeFormatter';
import { useConnectedServiceAuthGroupsQuery } from '@/hooks/server/connectedServices/useConnectedServiceAuthGroupsQuery';
import { useProviderUsageSources } from './useProviderUsageSources';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import {
    type ProviderUsageDisplaySnapshotSource,
} from '@/sync/domains/connectedServices/accountUsage/selectors';
import {
    computeConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeSource,
    type ConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeWindowMode,
    type ConnectedServiceQuotaProfileRefProvenance,
} from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import {
    connectedServiceProfileKey,
    resolveConnectedServiceProfileLabel,
} from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { resolveConnectedServiceProjectionSignature } from '@/sync/domains/connectedServices/resolveConnectedServiceProjectionSignature';
import { useProfile, useSetting } from '@/sync/domains/state/storage';
import { nowServerMs } from '@/sync/runtime/time';
import { t } from '@/text';

export type ProviderUsageGaugeProfileRef = Readonly<{
    serviceId: string;
    profileId: string;
    groupId?: string;
    credentialHealthStatus?: unknown;
    provenance: ConnectedServiceQuotaProfileRefProvenance;
}>;

export type ProviderUsageGaugeResult = Readonly<{
    gauge: ConnectedServiceQuotaGaugeViewModel | null;
    gaugeSource: ConnectedServiceQuotaGaugeSource | null;
    displaySnapshotSource: ProviderUsageDisplaySnapshotSource | null;
    profileKey: string | null;
    /** Effective explicit or default account used by this gauge and its refresh action. */
    profileRef: ProviderUsageGaugeProfileRef | null;
    windowMode: ConnectedServiceQuotaGaugeWindowMode;
}>;

function resolveConnectedServiceProviderDisplayName(serviceId: string): string | null {
    const parsed = ConnectedServiceIdSchema.safeParse(serviceId);
    if (!parsed.success) return null;
    return resolveConnectedServiceDisplayName(parsed.data, t);
}

/**
 * Single composer-facing owner of the provider usage (quota) gauge. The session composer and the
 * new-session composer both read it, so the gauge visibility setting, window modes, pinned meters,
 * account-group limit selection and the "no fake gauges" source rules apply identically to both.
 * Usage sources are resolved by the same account owner as the HUD and picker. Session
 * inputs select an account and expose recovery actions; they do not override its usage.
 */
export function useProviderUsageGauge(params: Readonly<{
    providerId: string | null;
    profileRef: ProviderUsageGaugeProfileRef | null;
    modelId: string | null;
    metadataRecordIds?: readonly string[];
    nativeAccount?: boolean;
    sessionCheckNowSupported?: boolean;
    recoveryCredits?: ConnectedServiceQuotaRecoveryCreditsV1 | null;
}>): ProviderUsageGaugeResult {
    const accountProfile = useProfile();
    const requests = React.useMemo(() => [{
        providerId: params.providerId,
        profileRef: params.profileRef,
        metadataRecordIds: params.metadataRecordIds,
        nativeAccount: params.nativeAccount,
        sessionCheckNowSupported: params.sessionCheckNowSupported,
        recoveryCredits: params.recoveryCredits,
    }], [params.providerId, params.profileRef, params.metadataRecordIds, params.nativeAccount, params.sessionCheckNowSupported, params.recoveryCredits]);
    const [resolved] = useProviderUsageSources({
        requests,
        connectedServices: accountProfile?.connectedServicesV2 ?? [],
        fetchEnabled: true,
    });
    const { profileRef, profileKey, quotaDisplaySnapshot, displaySnapshotSource } = resolved;
    const connectedServiceQuotasEnabled = useFeatureEnabled('connectedServices.quotas');
    const windowModesSetting = useSetting('sessionProviderUsageGaugeWindowModes');
    const numberWindowMode = useSetting('sessionProviderUsageGaugeNumberWindowMode');
    const pinnedQuotaMeterIdsByKey = useSetting('connectedServicesQuotaPinnedMeterIdsByKey');
    const gaugeMode = useSetting('sessionProviderUsageGaugeMode');
    const windowModeSetting = useSetting('sessionProviderUsageGaugeWindowMode');
    const profileLabelByKey = useSetting('connectedServicesProfileLabelByKey');
    const windowMode: ConnectedServiceQuotaGaugeWindowMode =
        windowModeSetting === 'daily'
        || windowModeSetting === 'weekly'
        || windowModeSetting === 'primary'
        || windowModeSetting === 'secondary'
        || windowModeSetting === 'session'
            ? windowModeSetting
            : 'most_constrained';

    const groupService = React.useMemo(() => (
        profileRef?.groupId
            ? accountProfile?.connectedServicesV2.find((service) => service.serviceId === profileRef.serviceId) ?? null
            : null
    ), [accountProfile?.connectedServicesV2, profileRef]);
    const groupServiceId = React.useMemo(() => {
        if (!profileRef?.groupId) return null;
        const parsed = ConnectedServiceIdSchema.safeParse(profileRef.serviceId);
        return parsed.success ? parsed.data : null;
    }, [profileRef]);
    const authGroups = useConnectedServiceAuthGroupsQuery({
        serviceId: groupServiceId,
        enabled: groupServiceId !== null,
        serviceProjectionSignature: resolveConnectedServiceProjectionSignature(groupService),
    });
    const quotaLimitSelection = React.useMemo(() => {
        if (!profileRef?.groupId) return undefined;
        const group = authGroups.groups.find((candidate) => candidate.groupId === profileRef.groupId);
        return group ? group.policy.quotaLimitSelection : null;
    }, [authGroups.groups, profileRef?.groupId]);

    const activeAccountLabel = React.useMemo(() => {
        if (!profileRef) return quotaDisplaySnapshot?.accountLabel ?? null;
        return resolveConnectedServiceProfileLabel({
            labelsByKey: profileLabelByKey,
            serviceId: profileRef.serviceId,
            profileId: profileRef.profileId,
        }) ?? quotaDisplaySnapshot?.accountLabel ?? profileRef.profileId;
    }, [profileRef, quotaDisplaySnapshot?.accountLabel, profileLabelByKey]);
    const gaugeSource = connectedServiceQuotasEnabled && gaugeMode !== 'hidden'
        ? resolved.gaugeSource : null;
    const gauge = React.useMemo(() => {
        if (!gaugeSource) return null;
        return computeConnectedServiceQuotaGaugeViewModel({
            snapshot: gaugeSource.snapshot,
            activeModelId: params.modelId,
            windowMode,
            windowModes: windowModesSetting,
            numberWindowMode,
            additionalMeterIds: profileRef && gaugeSource.snapshot.serviceId === profileRef.serviceId
                ? pinnedQuotaMeterIdsByKey[connectedServiceProfileKey(gaugeSource.snapshot)] ?? []
                : [],
            quotaLimitSelection,
            nowMs: nowServerMs(),
            formatter: connectedServiceQuotaGaugeFormatter,
            providerDisplayName: resolveConnectedServiceProviderDisplayName(gaugeSource.snapshot.serviceId),
            activeAccountDisplayLabel: displaySnapshotSource?.kind === 'connected_service_quota_view'
                && gaugeSource.snapshot === quotaDisplaySnapshot
                ? activeAccountLabel
                : gaugeSource.snapshot.accountLabel ?? null,
        });
    }, [
        activeAccountLabel,
        displaySnapshotSource?.kind,
        gaugeSource,
        params.modelId,
        pinnedQuotaMeterIdsByKey,
        profileRef,
        quotaDisplaySnapshot,
        quotaLimitSelection,
        windowMode,
        windowModesSetting,
        numberWindowMode,
    ]);

    return React.useMemo(() => ({
        gauge,
        gaugeSource,
        displaySnapshotSource,
        profileKey,
        profileRef,
        windowMode,
    }), [displaySnapshotSource, gauge, gaugeSource, profileKey, profileRef, windowMode]);
}
