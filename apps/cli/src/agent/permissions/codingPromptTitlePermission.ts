import {
  getSessionTitleFromMetadata,
  resolveCodingPromptSessionTitleInstructionModeV1,
  parseHappierToolsShellBridgeCommand,
} from '@happier-dev/protocol';
import { isChangeTitleToolLikeName } from '@happier-dev/protocol/tools/v2';

import { extractShellCommand } from './permissionToolIdentifier';

function readActionId(input: unknown): string {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return '';
  const raw = (input as Record<string, unknown>).actionId;
  return typeof raw === 'string' ? raw.trim() : '';
}

function isTitleActionExecute(toolName: string, input: unknown): boolean {
  const lower = toolName.toLowerCase();
  return lower.includes('action_execute') && readActionId(input) === 'session.title.set';
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readTitle(input: unknown): string | null {
  const title = readRecord(input)?.title;
  return typeof title === 'string' ? title : null;
}

function readTitleActionInput(input: unknown): string | null {
  return readTitle(readRecord(input)?.input);
}

function readRequestedSessionTitle(toolName: string, input: unknown): string | null {
  if (isTitleActionExecute(toolName, input)) return readTitleActionInput(input);

  const lowerToolName = toolName.toLowerCase();
  if (lowerToolName === 'bash' || lowerToolName === 'execute' || lowerToolName === 'shell') {
    const command = extractShellCommand(input);
    const parsed = command ? parseHappierToolsShellBridgeCommand(command) : null;
    if (!parsed || parsed.kind !== 'call' || parsed.source !== 'happier') return null;
    if (isTitleActionExecute(parsed.tool, parsed.args)) return readTitleActionInput(parsed.args);
    return isChangeTitleToolLikeName(parsed.tool) ? readTitle(parsed.args) : null;
  }

  return isChangeTitleToolLikeName(toolName) ? readTitle(input) : null;
}

const SESSION_TITLE_VERSION_TOKEN = /(?<![A-Za-z0-9])v?\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?![A-Za-z0-9])/g;

function getSingleVersionToken(title: string): Readonly<{ value: string; before: string; after: string }> | null {
  const matches = Array.from(title.matchAll(SESSION_TITLE_VERSION_TOKEN));
  if (matches.length !== 1) return null;
  const match = matches[0];
  const value = match[0];
  const start = match.index;
  if (typeof start !== 'number') return null;
  return { value, before: title.slice(0, start), after: title.slice(start + value.length) };
}

function isVersionOnlySessionTitleUpdate(currentTitle: string | null, requestedTitle: string | null): boolean {
  if (currentTitle === null || requestedTitle === null || currentTitle === requestedTitle) return false;
  const current = getSingleVersionToken(currentTitle);
  const requested = getSingleVersionToken(requestedTitle);
  return current !== null
    && requested !== null
    && current.value !== requested.value
    && current.before === requested.before
    && current.after === requested.after;
}

function isShellBridgeTitleCall(toolName: string, input: unknown): boolean {
  const lowerToolName = toolName.toLowerCase();
  if (lowerToolName !== 'bash' && lowerToolName !== 'execute' && lowerToolName !== 'shell') return false;

  const command = extractShellCommand(input);
  if (!command) return false;

  const parsed = parseHappierToolsShellBridgeCommand(command);
  if (!parsed || parsed.kind !== 'call') return false;
  if (parsed.source !== 'happier') return false;
  return parsed.tool === 'change_title'
    || parsed.tool === 'session_title_set'
    || isTitleActionExecute(parsed.tool, parsed.args);
}

export function isAgentSessionTitleToolCall(toolName: string, input: unknown): boolean {
  return isChangeTitleToolLikeName(toolName)
    || isTitleActionExecute(toolName, input)
    || isShellBridgeTitleCall(toolName, input);
}

/**
 * Enforces the title mode at the write boundary, not just in the prompt: start-only ('initial')
 * mode behaves as disabled once the Happier Session already has a title, so a replayed or
 * stale instruction cannot make an agent overwrite it. Explicit user renames do not pass here.
 */
export function shouldDenyAgentSessionTitleToolCall(params: Readonly<{
  settings: unknown;
  sessionMetadata?: unknown;
  toolName: string;
  input: unknown;
}>): boolean {
  if (!isAgentSessionTitleToolCall(params.toolName, params.input)) return false;
  if (resolveCodingPromptSessionTitleInstructionModeV1(params.settings, params.sessionMetadata) !== 'disabled') return false;
  // Locked titles permit a release/build version refresh, but preserve the exact surrounding title text.
  return !isVersionOnlySessionTitleUpdate(
    getSessionTitleFromMetadata(params.sessionMetadata),
    readRequestedSessionTitle(params.toolName, params.input),
  );
}
