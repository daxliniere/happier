import * as React from 'react';

import { connectedServiceQuotaGaugeFormatter } from '@/components/sessions/usage/connectedServiceQuotaGaugeFormatter';
import { resolveProviderUsageGaugeWindowMode } from '@/components/sessions/usage/resolveProviderUsageGaugeWindowMode';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import {
    computeConnectedServiceQuotaGaugeViewModel,
    type ConnectedServiceQuotaGaugeViewModel,
} from '@/sync/domains/connectedServices/connectedServiceQuotaGauge';
import { connectedServiceProfileKey } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { shouldHideQuotaForCredentialStatus } from '@/sync/domains/connectedServices/shouldHideQuotaForCredentialStatus';
import { useSettings } from '@/sync/store/hooks';
import { nowServerMs } from '@/sync/runtime/time';

import {
    ConnectedServiceIdSchema,
    type ConnectedServiceId,
} from '@happier-dev/protocol';

import { useConnectedServiceQuotaSnapshots } from './useConnectedServiceQuotaSnapshots';

type ProfileRef = Readonly<{ serviceId: string; profileId: string; credentialHealthStatus?: unknown }>;
type NormalizedProfileRef = Readonly<{
    key: string;
    serviceId: ConnectedServiceId;
    profileId: string;
    credentialHealthStatus?: unknown;
    credentialHealthUsable: boolean;
}>;

function normalizeProfileRefs(profiles: ReadonlyArray<ProfileRef>): NormalizedProfileRef[] {
    const next: NormalizedProfileRef[] = [];
    const seenKeys = new Set<string>();
    for (const profile of profiles) {
        const serviceIdRaw = String(profile.serviceId ?? '').trim();
        const serviceIdParsed = ConnectedServiceIdSchema.safeParse(serviceIdRaw);
        const profileId = String(profile.profileId ?? '').trim();
        if (!serviceIdParsed.success || !profileId) continue;

        const serviceId = serviceIdParsed.data;
        const key = connectedServiceProfileKey({ serviceId, profileId });
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        // Usage DISPLAY gate: fail OPEN via the single shared predicate (same owner
        // as the single/plural hooks + AccountBlock). Only an EXPLICIT needs_reauth
        // hides usage; absent/unknown/'' show usage — no independent derivation.
        next.push({
            key,
            serviceId,
            profileId,
            ...(profile.credentialHealthStatus !== undefined ? { credentialHealthStatus: profile.credentialHealthStatus } : {}),
            credentialHealthUsable: !shouldHideQuotaForCredentialStatus(profile.credentialHealthStatus),
        });
    }
    return next;
}

/**
 * Each connected profile's usage gauge, for the coloured usage rings drawn beside its account in
 * the account pickers. The same gauge, window settings and pinned limits as the composer's ring, so
 * an account shows the same rings wherever it appears. A profile without readable usage (needs
 * reauth, no snapshot yet, quotas disabled) has no entry.
 */
export function useConnectedServiceQuotaGauges(
    profiles: ReadonlyArray<ProfileRef>,
): Readonly<Record<string, ConnectedServiceQuotaGaugeViewModel>> {
    const quotasEnabled = useFeatureEnabled('connectedServices.quotas');
    const settings = useSettings();
    const pinnedByKey = settings.connectedServicesQuotaPinnedMeterIdsByKey;
    const windowMode = resolveProviderUsageGaugeWindowMode(settings.sessionProviderUsageGaugeWindowMode);
    const windowModes = settings.sessionProviderUsageGaugeWindowModes;
    const numberWindowMode = settings.sessionProviderUsageGaugeNumberWindowMode;

    const normalizedProfiles = React.useMemo(() => normalizeProfileRefs(profiles), [profiles]);
    const { snapshotsByKey } = useConnectedServiceQuotaSnapshots(normalizedProfiles, { fetchPolicy: 'poll' });

    return React.useMemo(() => {
        const gaugesByKey: Record<string, ConnectedServiceQuotaGaugeViewModel> = {};
        if (!quotasEnabled) return gaugesByKey;
        const nowMs = nowServerMs();
        for (const profile of normalizedProfiles) {
            if (!profile.credentialHealthUsable) continue;
            const gauge = computeConnectedServiceQuotaGaugeViewModel({
                snapshot: snapshotsByKey[profile.key] ?? null,
                windowMode,
                windowModes,
                numberWindowMode,
                additionalMeterIds: pinnedByKey[profile.key] ?? [],
                nowMs,
                formatter: connectedServiceQuotaGaugeFormatter,
            });
            if (gauge) gaugesByKey[profile.key] = gauge;
        }
        return gaugesByKey;
    }, [normalizedProfiles, numberWindowMode, pinnedByKey, quotasEnabled, snapshotsByKey, windowMode, windowModes]);
}
