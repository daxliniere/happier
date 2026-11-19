import * as React from 'react';

import { ContextMenu } from '@/components/ui/forms/dropdown/ContextMenu';
import { getAllKnownTags, sessionTagKey } from '@/components/sessions/shell/sessionTagUtils';
import { useSessionOrganizationProjection } from '@/sync/domains/state/storage';
import { buildSessionOrganizationListViewState } from '@/sync/domains/session/organization/viewState';
import { resolveSessionOrganizationMutationScope } from '@/sync/domains/session/organization/mutationScope';
import { setSessionTagLabels } from '@/sync/ops/sessionOrganization';
import { t } from '@/text';

import { useSessionTagMenu } from './useSessionTagMenu';

const EMPTY_TAGS: readonly string[] = Object.freeze([]);

/** Mounted only while the header's tag editor is open. */
export function SessionHeaderTagMenu(props: Readonly<{
    serverId: string;
    sessionId: string;
    anchorRef: React.RefObject<unknown>;
    iconColor: string;
    onOpenChange: (open: boolean) => void;
}>) {
    const projection = useSessionOrganizationProjection(props.serverId);
    const tags = React.useMemo(() => buildSessionOrganizationListViewState({
        serverId: props.serverId,
        projection,
    }).sessionTagsV1, [projection, props.serverId]);
    const knownTags = React.useMemo(() => getAllKnownTags(tags), [tags]);
    const onSetTags = React.useCallback(async (next: string[]) => {
        const mutation = await resolveSessionOrganizationMutationScope(props.serverId);
        if (!mutation.ok) throw new Error(t('errors.unknownError'));
        await setSessionTagLabels({ ...mutation.scope, sessionId: props.sessionId, tags: next });
    }, [props.serverId, props.sessionId]);
    const { tagMenuItems, handleTagMenuSelect, handleTagMenuCreate } = useSessionTagMenu({
        activeTags: tags[sessionTagKey(props.serverId, props.sessionId)] ?? EMPTY_TAGS,
        knownTags,
        iconColor: props.iconColor,
        onSetTags,
    });
    return <ContextMenu
        open
        onOpenChange={props.onOpenChange}
        anchorRef={props.anchorRef}
        items={tagMenuItems}
        onSelect={handleTagMenuSelect}
        onCreateItem={handleTagMenuCreate}
        placement="auto"
        variant="slim"
        search
        searchPlaceholder={t('sessionTags.searchOrAddPlaceholder')}
        emptyLabel={null}
        showCategoryTitles={false}
        maxWidthCap={260}
    />;
}
