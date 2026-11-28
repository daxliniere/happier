import * as React from 'react';

import { isPrimaryModifierHeld, isPrimaryModifierPressEvent } from '@/keyboard/pressModifiers';
import { resolveKeyboardPlatform } from '@/keyboard/runtime';
import type { KeyboardPlatform } from '@/keyboard/types';
import type { NewSessionDraftEntryMode } from '@/sync/domains/settings/registry/account/accountSessionCreationSettingDefinitions';
import { useActiveServerAccountScope, useSetting } from '@/sync/domains/state/storage';
import {
    getSessionDraftSnapshot,
    readOrdinaryEntryDraftId,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';

import { resolveNewSessionDraftRouteIdentity } from './newSessionDraftRouteIdentity';

export type NewSessionOrdinaryEntryRouteResolution = Readonly<{
    draftId: string;
    draftOrigin: 'ordinary';
    resumedPrevious: boolean;
}>;

export function resolveNewSessionOrdinaryEntryRoute(params: Readonly<{
    entryMode: NewSessionDraftEntryMode;
    forceFresh: boolean;
    ordinaryEntryDraftId: string | null;
    ordinaryEntryDraftIsMeaningful: boolean;
    createDraftId?: () => string;
}>): NewSessionOrdinaryEntryRouteResolution {
    if (
        !params.forceFresh
        && params.entryMode === 'resumePrevious'
        && params.ordinaryEntryDraftIsMeaningful
        && params.ordinaryEntryDraftId
    ) {
        const resumed = resolveNewSessionDraftRouteIdentity({
            routeDraftId: params.ordinaryEntryDraftId,
            createDraftId: params.createDraftId,
        });
        if (!resumed.shouldWriteRouteParam) {
            return {
                draftId: resumed.draftId,
                draftOrigin: 'ordinary',
                resumedPrevious: true,
            };
        }
    }

    return {
        draftId: resolveNewSessionDraftRouteIdentity({
            routeDraftId: undefined,
            createDraftId: params.createDraftId,
        }).draftId,
        draftOrigin: 'ordinary',
        resumedPrevious: false,
    };
}

export function shouldForceFreshNewSessionEntry(params: Readonly<{
    platform: KeyboardPlatform;
    metaKey: boolean;
    ctrlKey: boolean;
}>): boolean {
    return isPrimaryModifierHeld(params);
}

export function shouldForceFreshNewSessionEntryFromPressEvent(
    event?: unknown,
    platform: KeyboardPlatform = resolveKeyboardPlatform(),
): boolean {
    return isPrimaryModifierPressEvent(event, platform);
}

export function useResolveNewSessionOrdinaryEntryRoute(): (
    options?: Readonly<{ forceFresh?: boolean; createDraftId?: () => string }>,
) => NewSessionOrdinaryEntryRouteResolution {
    const entryMode = useSetting('newSessionDraftEntryMode');
    const scope = useActiveServerAccountScope();

    return React.useCallback((options = {}) => {
        const ordinaryEntryDraftId = scope ? readOrdinaryEntryDraftId(scope) : null;
        const snapshot = scope && ordinaryEntryDraftId
            ? getSessionDraftSnapshot(scope, { kind: 'newSession', draftId: ordinaryEntryDraftId })
            : null;
        return resolveNewSessionOrdinaryEntryRoute({
            entryMode,
            forceFresh: options.forceFresh === true,
            ordinaryEntryDraftId,
            ordinaryEntryDraftIsMeaningful: snapshot?.materialized === true,
            createDraftId: options.createDraftId,
        });
    }, [entryMode, scope]);
}
