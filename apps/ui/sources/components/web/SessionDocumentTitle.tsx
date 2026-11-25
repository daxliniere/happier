import * as React from 'react';
import { useGlobalSearchParams, useSegments } from 'expo-router';
import { readSessionRouteServerId } from '@/hooks/session/sessionRouteServerScope';
import { areServerProfileIdentifiersEquivalent, resolveServerProfileScopeIdForIdentifier } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storage';
import { resolveServerIdForSessionIdFromLocalState } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';

export function SessionDocumentTitle({ enabled }: Readonly<{ enabled: boolean }>): null {
    const segments: readonly string[] = useSegments();
    const params = useGlobalSearchParams<{ id?: string | string[]; serverId?: string | string[] }>();
    const isSessionRoute = segments[0] === '(app)' && segments[1] === 'session' && segments[2] === '[id]';
    const sessionId = enabled && isSessionRoute
        ? (Array.isArray(params.id) ? params.id[0] : params.id)?.trim()
        : undefined;
    const serverId = readSessionRouteServerId(params);
    const name = storage((state) => {
        if (!sessionId) return null;
        const session = state.sessions[sessionId];
        if (session?.metadata && (!serverId || areServerProfileIdentifiersEquivalent(
            resolveServerIdForSessionIdFromLocalState(state, sessionId),
            serverId,
        ))) {
            return getSessionName(session);
        }
        if (!serverId) {
            const cached = state.sessionListRenderables[sessionId];
            return cached?.metadata ? getSessionName(cached) : null;
        }
        const items = state.sessionListViewDataByServerId[serverId]
            ?? state.sessionListViewDataByServerId[resolveServerProfileScopeIdForIdentifier(serverId)];
        const row = items?.find((item) => item.type === 'session' && item.session.id === sessionId);
        return row?.type === 'session' && row.session.metadata ? getSessionName(row.session) : null;
    });
    const title = name ? t('navigation.sessionDocumentTitle', { name }) : null;

    const defaultTitle = React.useRef('');
    React.useEffect(() => {
        defaultTitle.current = document.title;
        return () => {
            document.title = defaultTitle.current;
        };
    }, []);
    React.useEffect(() => {
        document.title = title ?? defaultTitle.current;
    }, [title]);

    return null;
}
