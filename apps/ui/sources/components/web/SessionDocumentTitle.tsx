import * as React from 'react';
import { useGlobalSearchParams, useSegments } from 'expo-router';
import { readSessionRouteServerId } from '@/hooks/session/sessionRouteServerScope';
import { areServerProfileIdentifiersEquivalent } from '@/sync/domains/server/serverProfiles';
import { storage } from '@/sync/domains/state/storage';
import { resolveServerIdForSessionIdFromLocalState } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
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
        if (!session?.metadata) return null;
        if (serverId) {
            const cachedServerId = resolveServerIdForSessionIdFromLocalState(state, sessionId);
            if (!cachedServerId || !areServerProfileIdentifiersEquivalent(cachedServerId, serverId)) return null;
        }
        return getSessionName(session);
    });

    const defaultTitle = React.useRef('');
    React.useEffect(() => {
        defaultTitle.current = document.title;
        return () => {
            document.title = defaultTitle.current;
        };
    }, []);
    React.useEffect(() => {
        document.title = name ? `Happier - ${name}` : defaultTitle.current;
    }, [name]);

    return null;
}
