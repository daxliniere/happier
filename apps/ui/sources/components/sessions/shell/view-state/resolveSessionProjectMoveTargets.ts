import type { SessionOrganizationLabel, SessionOrganizationSessionAppearance } from '@happier-dev/protocol';
import type { MachineDisplayRenderable } from '@/sync/domains/machines/machineDisplayRenderable';
import { compareSessionFolderWorkspaceRefs, resolveDurableWorkspaceRefForSessionListHeader, type SessionFolderWorkspaceRefV1 } from '@/sync/domains/session/folders';
import { buildSessionListViewData, resolveSessionListDateGroupingAt, type SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionProjectAssignments } from '@/sync/domains/session/organization/projectAssignment';
import { resolveServerWorkspaceDisplay } from '@/sync/domains/session/organization/workspaceDisplay';
import type { SessionProjectMoveTarget } from '../move-sheet/SessionProjectMoveSheet';

/** Called on picker open with the unfiltered server snapshot, independently of collapse/date views. */
export function resolveSessionProjectMoveTargets(params: Readonly<{
    items: readonly SessionListViewItem[];
    serverId: string;
    assignments: SessionProjectAssignments;
    appearances?: Readonly<Record<string, SessionOrganizationSessionAppearance>>;
    labels: Readonly<Record<string, SessionOrganizationLabel>>;
    currentWorkspace?: SessionFolderWorkspaceRefV1;
}>): SessionProjectMoveTarget[] {
    const sessions: Record<string, SessionListRenderableSession> = {};
    const machines: Record<string, MachineDisplayRenderable> = {};
    for (const item of params.items) {
        if (item.serverId !== params.serverId) continue;
        if (item.type === 'session' && !item.session.owner) sessions[item.session.id] = item.session;
        else if (item.type === 'header' && item.machine) machines[item.machine.id] = item.machine;
    }
    const options = { groupInactiveSessionsByProject: true, sectionModeV1: 'single' as const, serverScope: { serverId: params.serverId } };
    const targets = new Map<string, SessionProjectMoveTarget>();
    const lastTouchedByTarget = new Map<string, number>();
    for (const assignments of [undefined, params.assignments]) {
        const items = buildSessionListViewData(sessions, machines, { ...options, projectAssignmentsBySessionKey: assignments });
        let targetId: string | null = null;
        for (const item of items) {
            if (item.type === 'session') {
                if (!targetId) continue;
                const sessionKey = `${params.serverId}:${item.session.id}`;
                // Only the visual destination receives the move touch; the natural project stays available.
                const movedAt = assignments?.[sessionKey] ? params.appearances?.[sessionKey]?.updatedAt ?? 0 : 0;
                lastTouchedByTarget.set(targetId, Math.max(lastTouchedByTarget.get(targetId) ?? 0,
                    resolveSessionListDateGroupingAt(item.session), movedAt));
                continue;
            }
            targetId = null;
            if (item.headerKind !== 'project') continue;
            const workspace = resolveDurableWorkspaceRefForSessionListHeader(item);
            if (workspace?.t !== 'workspaceScope' || !workspace.machineId) continue;
            const id = `${params.serverId}:${item.workspaceKey}`;
            targetId = id;
            const display = resolveServerWorkspaceDisplay(params.labels, params.serverId, item.workspaceKey);
            targets.set(id, { id, title: display.label ?? item.title,
                subtitle: `${item.subtitle ?? workspace.machineId} · ${workspace.rootPath}`,
                machineId: workspace.machineId, rootPath: workspace.rootPath,
                disabled: Boolean(params.currentWorkspace && compareSessionFolderWorkspaceRefs(params.currentWorkspace, workspace)),
            });
        }
    }
    return [...targets.values()].sort((a, b) => (lastTouchedByTarget.get(b.id) ?? 0) - (lastTouchedByTarget.get(a.id) ?? 0)
        || a.title.localeCompare(b.title) || a.subtitle.localeCompare(b.subtitle));
}
