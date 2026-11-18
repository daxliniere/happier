/** The Session's visible title, including the legacy name field during migration. */
export function getSessionTitleFromMetadata(sessionMetadata: unknown): string | null {
  const metadata = sessionMetadata && typeof sessionMetadata === 'object' && !Array.isArray(sessionMetadata)
    ? sessionMetadata as Record<string, unknown>
    : null;
  const summary = metadata?.summary;
  const summaryText = summary && typeof summary === 'object' && !Array.isArray(summary) && 'text' in summary
    ? summary.text
    : null;
  // summary.text is the title writer's current shape; name also covers legacy named Sessions.
  return [summaryText, metadata?.name].find((title): title is string =>
    typeof title === 'string' && title.trim().length > 0,
  ) ?? null;
}

/** Whether the Session already has a title that automatic initialization must preserve. */
export function hasSessionTitleInMetadata(sessionMetadata: unknown): boolean {
  return getSessionTitleFromMetadata(sessionMetadata) !== null;
}
