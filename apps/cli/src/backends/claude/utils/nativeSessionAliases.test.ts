import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readClaudeNativeSessionAliases } from './nativeSessionAliases';

it('reads exact Claude assignment evidence from session registration files', async () => {
  // Mirrors the nonsecret fields of Claude's per-session registration files.
  const registrations = [
    { name: 'alpha-session', sessionId: '11111111-1111-4111-8111-111111111111', nameSince: 1793146034751, startedAt: 1793146034751 },
    { name: 'beta-session', sessionId: '22222222-2222-4222-8222-222222222222', nameSince: 1793211062180, startedAt: 1793211062180 },
  ];
  const configDir = await mkdtemp(join(tmpdir(), 'claude-snapshot-alias-'));
  const observedAt = Date.parse('2026-10-28T21:27:00.000Z');
  try {
    await mkdir(join(configDir, 'sessions'));
    for (const [index, registration] of registrations.entries()) {
      await writeFile(join(configDir, 'sessions', `${index + 1}.json`), JSON.stringify(registration));
    }
    for (const registration of registrations) {
      expect(await readClaudeNativeSessionAliases({ configDir, sessionId: registration.sessionId, observedAt })).toEqual([{
        providerId: 'claude', providerSessionId: registration.sessionId, alias: registration.name,
        assignedAt: registration.nameSince, observedAt,
      }]);
    }
    expect(await readClaudeNativeSessionAliases({ configDir, sessionId: 'unrecoverable-eb', observedAt })).toEqual([]);
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
});
