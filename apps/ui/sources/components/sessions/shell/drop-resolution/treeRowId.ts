export const treeRowId = Object.freeze({
    folder: (id: string) => `folder:${id.trim()}`,
    session: (serverId: string, sessionId: string) => `session:${serverId.trim()}:${sessionId.trim()}`,
    // A workspace can have separate visible headings in Active and Inactive.
    // This is a presentation id; persisted order keys still identify the workspace alone.
    workspaceRoot: (workspaceKey: string, section?: string) => `workspace-root:${section ? `${section}:` : ''}${workspaceKey.trim()}`,
});

export function readFolderIdFromTreeRowId(rowId: string): string | null {
    const prefix = 'folder:';
    return rowId.startsWith(prefix) ? rowId.slice(prefix.length).trim() || null : null;
}
