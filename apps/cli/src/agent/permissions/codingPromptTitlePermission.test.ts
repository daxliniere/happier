import { describe, expect, it } from 'vitest';

import { shouldDenyAgentSessionTitleToolCall } from './codingPromptTitlePermission';

const settingsFor = (sessionTitleUpdates: string) => ({
  codingPromptBehaviorV1: { v: 1, sessionTitleUpdates, responseOptions: 'agent' },
});

const titleCall = { toolName: 'mcp__happier__change_title', input: { title: 'Renamed' } } as const;
const titled = { summary: { text: 'Existing title', updatedAt: 1 } };
const legacyNamed = { name: 'Legacy name' };

describe('shouldDenyAgentSessionTitleToolCall', () => {
  it('denies an agent rename in start-only mode once the session already has a title', () => {
    expect(shouldDenyAgentSessionTitleToolCall({ settings: settingsFor('initial'), sessionMetadata: titled, ...titleCall })).toBe(true);
    expect(shouldDenyAgentSessionTitleToolCall({ settings: settingsFor('initial'), sessionMetadata: legacyNamed, ...titleCall })).toBe(true);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('initial'),
      sessionMetadata: titled,
      toolName: 'happier_action_execute',
      input: { actionId: 'session.title.set' },
    })).toBe(true);
  });

  it('allows the initial naming of an untitled session in start-only mode', () => {
    expect(shouldDenyAgentSessionTitleToolCall({ settings: settingsFor('initial'), sessionMetadata: null, ...titleCall })).toBe(false);
    expect(shouldDenyAgentSessionTitleToolCall({ settings: settingsFor('initial'), sessionMetadata: { summary: { text: '  ' } }, ...titleCall })).toBe(false);
    expect(shouldDenyAgentSessionTitleToolCall({ settings: settingsFor('initial'), ...titleCall })).toBe(false);
  });

  it('allows renames in ongoing mode even when titled', () => {
    expect(shouldDenyAgentSessionTitleToolCall({ settings: settingsFor('ongoing'), sessionMetadata: titled, ...titleCall })).toBe(false);
  });

  it('allows only a version-token update when title updates are otherwise disabled', () => {
    const existingTitle = '⭐Build latest packages: v0.2.20-beta1.7';
    const nextTitle = '⭐Build latest packages: v0.2.20-beta1.8';

    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { summary: { text: existingTitle } },
      toolName: 'mcp__happier__change_title',
      input: { title: nextTitle },
    })).toBe(false);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { summary: { text: existingTitle } },
      toolName: 'mcp__happier__change_title',
      input: { title: 'Build beta1.8' },
    })).toBe(true);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { summary: { text: existingTitle } },
      toolName: 'mcp__happier__change_title',
      input: { title: '⭐Build latest packages v0.2.20-beta1.8' },
    })).toBe(true);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: null,
      toolName: 'mcp__happier__change_title',
      input: { title: nextTitle },
    })).toBe(true);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { name: existingTitle },
      toolName: 'mcp__happier__session_title_set',
      input: { title: nextTitle },
    })).toBe(false);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { summary: { text: existingTitle } },
      toolName: 'mcp__happier__change_title',
      input: { title: '⭐Build latest packages: v0.2.20-beta1.7' },
    })).toBe(true);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { summary: { text: `${existingTitle} based on v1.2.3` } },
      toolName: 'mcp__happier__change_title',
      input: { title: '⭐Build latest packages: v0.2.20-beta1.8 based on v1.2.3' },
    })).toBe(true);
  });

  it('allows the same constrained version update through the shell bridge title action', () => {
    const existingTitle = '⭐Build latest packages: v0.2.20-beta1.7';
    const command = (title: string) =>
      `happier tools call --source happier --tool change_title --args-json '${JSON.stringify({ title })}' --json`;

    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { summary: { text: existingTitle } },
      toolName: 'Bash',
      input: { command: command('⭐Build latest packages: v0.2.20-beta1.8') },
    })).toBe(false);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { summary: { text: existingTitle } },
      toolName: 'Bash',
      input: { command: command('⭐Build beta1.8') },
    })).toBe(true);
  });

  it('allows a version-only update in initial mode after the first title is already set', () => {
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('initial'),
      sessionMetadata: { summary: { text: '⭐Build latest packages: v0.2.20-beta1.7' } },
      toolName: 'mcp__happier__change_title',
      input: { title: '⭐Build latest packages: v0.2.20-beta1.8' },
    })).toBe(false);
  });

  it('allows a version-only update through the nested session title action', () => {
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('disabled'),
      sessionMetadata: { summary: { text: '⭐Build latest packages: v0.2.20-beta1.7' } },
      toolName: 'happier_action_execute',
      input: {
        actionId: 'session.title.set',
        input: { title: '⭐Build latest packages: v0.2.20-beta1.8' },
      },
    })).toBe(false);
  });

  it('never denies unrelated tool calls', () => {
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('initial'),
      sessionMetadata: titled,
      toolName: 'mcp__happier__execution_run_get',
      input: {},
    })).toBe(false);
  });

  it('recognizes nested title actions through the shell bridge without denying unrelated actions', () => {
    const shellCall = (actionId: string) => ({
      toolName: 'Bash',
      input: { command: `happier tools call --source happier --tool action_execute --args-json '${JSON.stringify({ actionId, input: { title: 'Renamed' } })}' --json` },
    });
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('initial'), sessionMetadata: titled, ...shellCall('session.title.set'),
    })).toBe(true);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('initial'), sessionMetadata: titled, ...shellCall('session.list'),
    })).toBe(false);
    expect(shouldDenyAgentSessionTitleToolCall({
      settings: settingsFor('ongoing'), sessionMetadata: titled, ...shellCall('session.title.set'),
    })).toBe(false);
  });
});
