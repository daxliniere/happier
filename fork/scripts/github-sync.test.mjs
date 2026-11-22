import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const syncScript = fileURLToPath(new URL('./github-sync.sh', import.meta.url));
const bumpScript = fileURLToPath(new URL('./bump-version.sh', import.meta.url));
const ident = ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid'];

// Real Git, real bump-version.sh and a real (local, bare) remote; only the GitHub origin is replaced.
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'happier sync '));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const remote = join(dir, 'origin.git');
  const repo = join(dir, 'repo with spaces');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  mkdirSync(join(repo, 'fork/scripts'), { recursive: true });
  mkdirSync(join(repo, 'apps/cli'), { recursive: true });
  writeFileSync(join(repo, 'fork/VERSION'), '0.2.21-beta1.2\n');
  writeFileSync(join(repo, 'fork/RELEASE'), '0.2.21-beta1.2\n');
  writeFileSync(join(repo, 'fork/build-version.json'), '{"version":"0.2.21-beta1.2","release":"0.2.21-beta1.2"}\n');
  writeFileSync(join(repo, 'apps/cli/package.json'), '{"name":"cli","happierForkVersion":"0.2.21-beta1.2","happierForkRelease":"0.2.21-beta1.2"}\n');
  copyFileSync(syncScript, join(repo, 'fork/scripts/github-sync.sh'));
  copyFileSync(bumpScript, join(repo, 'fork/scripts/bump-version.sh'));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', remote);
  git('add', '.');
  git(...ident, 'commit', '-qm', '0.2.21-beta1.2');
  git('push', '-q', '-u', 'origin', 'main');
  const run = (...args) => spawnSync('bash', [join(repo, 'fork/scripts/github-sync.sh'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' },
  });
  const remoteHead = () => execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim();
  return { repo, git, run, remoteHead };
}

test('a clean worktree commits nothing and just pushes', (t) => {
  const { git, run, remoteHead } = fixture(t);
  const before = git('rev-parse', 'HEAD');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('rev-parse', 'HEAD'), before);
  assert.equal(remoteHead(), before);
  assert.match(result.stdout, /Synced main at 0\.2\.21-beta1\.2/);
});

test('uncommitted and untracked work is bumped, committed under the new version and pushed', (t) => {
  const { repo, git, run, remoteHead } = fixture(t);
  writeFileSync(join(repo, 'tracked-change.txt'), 'new\n');
  writeFileSync(join(repo, 'fork/VERSION.bak-not-this'), 'untracked\n');
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('log', '-1', '--format=%s'), '0.2.21-beta1.3');
  assert.equal(readFileSync(join(repo, 'fork/VERSION'), 'utf8').trim(), '0.2.21-beta1.3');
  assert.equal(git('status', '--porcelain'), '');
  assert.match(git('show', '--stat', '--format=', 'HEAD'), /tracked-change\.txt/);
  assert.match(git('show', '--stat', '--format=', 'HEAD'), /VERSION\.bak-not-this/);
  assert.equal(remoteHead(), git('rev-parse', 'HEAD'));
});

test('a version already bumped since HEAD is reused, not bumped again, and custom wording follows it', (t) => {
  const { repo, git, run, remoteHead } = fixture(t);
  writeFileSync(join(repo, 'fork/VERSION'), '0.2.21-beta1.3\n');
  writeFileSync(join(repo, 'change.txt'), 'x\n');
  const result = run('READY TO GO! (needs more SFX)');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git('log', '-1', '--format=%s'), '0.2.21-beta1.3 READY TO GO! (needs more SFX)');
  assert.equal(readFileSync(join(repo, 'fork/VERSION'), 'utf8').trim(), '0.2.21-beta1.3');
  assert.equal(remoteHead(), git('rev-parse', 'HEAD'));
});

test('--dry-run reports the plan and changes nothing locally or remotely', (t) => {
  const { repo, git, run, remoteHead } = fixture(t);
  writeFileSync(join(repo, 'change.txt'), 'x\n');
  const headBefore = git('rev-parse', 'HEAD');
  const remoteBefore = remoteHead();
  const result = run('--dry-run', 'wording');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Would commit as: 0\.2\.21-beta1\.3 wording/);
  assert.match(result.stdout, /\?\? change\.txt/);
  assert.equal(git('rev-parse', 'HEAD'), headBefore);
  assert.equal(remoteHead(), remoteBefore);
  assert.equal(readFileSync(join(repo, 'fork/VERSION'), 'utf8').trim(), '0.2.21-beta1.2');
  assert.match(git('status', '--porcelain'), /\?\? change\.txt/);
});

test('a failed push is reported and returns nonzero after the commit is kept', (t) => {
  const { repo, git, run } = fixture(t);
  git('remote', 'set-url', 'origin', join(repo, 'does-not-exist.git'));
  writeFileSync(join(repo, 'change.txt'), 'x\n');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /git push failed/);
  assert.equal(git('log', '-1', '--format=%s'), '0.2.21-beta1.3');
});

test('a detached HEAD is refused before anything is committed', (t) => {
  const { repo, git, run } = fixture(t);
  git('checkout', '-q', '--detach');
  writeFileSync(join(repo, 'change.txt'), 'x\n');
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /detached/i);
  assert.match(git('status', '--porcelain'), /\?\? change\.txt/);
});
