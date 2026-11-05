import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../../!verify-local.sh', import.meta.url));

function fixture(t, exitCode = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'happier verify '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo with spaces');
  mkdirSync(join(repo, 'apps/stack/bin'), { recursive: true });
  mkdirSync(join(repo, 'scripts/pipeline'), { recursive: true });
  mkdirSync(join(repo, 'fork'), { recursive: true });
  writeFileSync(join(repo, 'fork/VERSION'), '0.2.19-fork.37\n');
  // The external check-process boundary is replaced; real Git and wrapper run.
  writeFileSync(join(repo, 'apps/stack/bin/hstack-exec'),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$@"\nexit ${exitCode}\n`, { mode: 0o755 });
  writeFileSync(join(repo, 'scripts/pipeline/run.mjs'), '');
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('add', '.');
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture');
  return { repo, dir, git };
}

test('records dirty worktrees and unmerged commits without modifying them; checks succeed', (t) => {
  const { repo, dir, git } = fixture(t);
  const other = join(dir, 'other worktree');
  git('worktree', 'add', '-qb', 'pending-feature', other);
  writeFileSync(join(other, 'feature.txt'), 'feature\n');
  execFileSync('git', ['-C', other, 'add', 'feature.txt']);
  execFileSync('git', ['-C', other, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'pending']);
  writeFileSync(join(other, 'dirty.txt'), 'keep me\n');
  const output = join(dir, 'results');
  const result = spawnSync('bash', [script, '--repo', repo, '--output', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(output, 'inventory.log'), 'utf8'), /pending-feature[\s\S]*\+ [a-f0-9]+/);
  assert.match(readFileSync(join(output, 'inventory.log'), 'utf8'), /\?\? dirty.txt/);
  assert.match(readFileSync(join(output, 'checks.log'), 'utf8'), /unit,typecheck/);
  assert.match(readFileSync(join(output, 'RESULT.txt'), 'utf8'), /PASS selected automated checks/);
  assert.equal(readFileSync(join(other, 'dirty.txt'), 'utf8'), 'keep me\n');
  assert.equal(git('status', '--porcelain'), '');
});

test('check failure returns nonzero, saves output, and never reports PASS', (t) => {
  const { repo, dir } = fixture(t, 17);
  const output = join(dir, 'failed');
  const result = spawnSync('bash', [script, '--repo', repo, '--checks', 'typecheck', '--output', output], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.match(readFileSync(join(output, 'RESULT.txt'), 'utf8'), /FAIL checks \(exit 17\)/);
  assert.doesNotMatch(readFileSync(join(output, 'RESULT.txt'), 'utf8'), /PASS selected automated checks/);
  assert.match(readFileSync(join(output, 'checks.log'), 'utf8'), /typecheck/);
});

test('rejects unsupported lanes and refuses to overwrite existing results', (t) => {
  const { repo, dir } = fixture(t);
  const invalid = spawnSync('bash', [script, '--repo', repo, '--checks', 'providers'], { encoding: 'utf8' });
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unsupported check/);
  const output = join(dir, 'existing');
  mkdirSync(output);
  writeFileSync(join(output, 'RESULT.txt'), 'keep');
  const result = spawnSync('bash', [script, '--repo', repo, '--output', output], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(output, 'RESULT.txt'), 'utf8'), 'keep');
});
