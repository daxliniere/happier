import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const runner = fileURLToPath(new URL('./linux-maintenance.sh', import.meta.url));
const members = ['happier-home.tar.gz', 'codex-home.tar.gz', 'claude-home.tar.gz',
  'systemd-user-units.tar.gz', 'happier-server-light.sqlite'];
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'happier-maintenance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backups = join(root, 'backups');
  mkdirSync(backups);
  const complete = name => {
    const path = join(backups, name);
    mkdirSync(path);
    for (const member of members) writeFileSync(join(path, member), member);
    writeFileSync(join(path, 'MANIFEST'), 'finished: fixture\n');
    writeFileSync(join(path, 'RESTORE.txt'), 'fixture');
    const sums = spawnSync('sha256sum', members, { cwd: path, encoding: 'utf8' });
    assert.equal(sums.status, 0);
    writeFileSync(join(path, 'SHA256SUMS'), sums.stdout);
    return path;
  };
  writeFileSync(join(root, 'deploy-linux.sh'), '#!/bin/sh\nprintf "%s|%s|%s|%s\\n" "$*" "$FULL_BACKUP" "$RELEASE_DIR" "$CLI_VERSION_NAME" > "$CALLS"\n');
  const calls = join(root, 'calls');
  const run = (action, args = [], env = {}, detached = false) => spawnSync('bash', [runner, root, action, ...(detached ? [] : ['--foreground']), '--yes', ...args], {
    encoding: 'utf8', env: { ...process.env, BACKUP_ROOT: backups, CALLS: calls, ...env },
  });
  return { root, backups, complete, calls, run };
}

test('cleanup deletes all older complete backups but keeps newest and incomplete directories', t => {
  const f = setup(t);
  const old = f.complete('full-20261101-120000');
  const middle = f.complete('full-20261102-120000');
  const newest = f.complete('full-20261103-120000');
  const incomplete = join(f.backups, 'full-20261104-120000');
  mkdirSync(incomplete);
  const result = f.run('prune');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(!existsSync(old)); assert.ok(!existsSync(middle));
  assert.ok(existsSync(newest)); assert.ok(existsSync(incomplete));
});

test('cleanup refuses a corrupt newest completed backup instead of deleting any backup', t => {
  const f = setup(t);
  const old = f.complete('full-20261101-120000');
  const newest = f.complete('full-20261102-120000');
  writeFileSync(join(newest, members[0]), 'corrupt');
  const result = f.run('prune');
  assert.notEqual(result.status, 0);
  assert.ok(existsSync(old)); assert.ok(existsSync(newest));
});

test('install reads build-runner version and supplies an exact verified rollback point', t => {
  const f = setup(t);
  const backup = f.complete('full-20261103-120000');
  const output = join(f.root, 'built release');
  mkdirSync(join(output, 'server'), { recursive: true });
  mkdirSync(join(output, 'cli'));
  writeFileSync(join(output, 'RESULT.txt'), 'Version: 0.2.19-fork.32\nSUCCESS\n');
  const result = f.run('install', [output]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(f.calls, 'utf8').trim(), `update|${backup}|${output}|0.2.19-fork.32`);
});

test('rollback rejects a corrupt backup before invoking deployment or services', t => {
  const f = setup(t);
  const backup = f.complete('full-20261103-120000');
  writeFileSync(join(backup, members[4]), 'corrupt');
  const result = f.run('rollback');
  assert.notEqual(result.status, 0);
  assert.ok(!existsSync(f.calls));
});

test('cleanup dry run does not remove the older backup', t => {
  const f = setup(t);
  const old = f.complete('full-20261101-120000');
  f.complete('full-20261103-120000');
  const result = f.run('prune', ['--dry-run']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(old));
});

test('backup checksums a newly completed backup and rejects a no-op backup command', t => {
  const f = setup(t);
  const before = f.complete('full-20261101-120000');
  writeFileSync(join(f.root, 'full-backup.sh'), '#!/bin/sh\nexit 0\n');
  assert.notEqual(f.run('backup').status, 0);
  writeFileSync(join(f.root, 'full-backup.sh'), `#!/bin/sh\ncp -a '${before}' "$BACKUP_ROOT/full-20261105-120000"\n`);
  const result = f.run('backup');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /BACKUP VERIFIED: .*full-20261105-120000/);
});

test('default backup launches a detached job with a durable log and explicit action', t => {
  const f = setup(t);
  const bin = join(f.root, 'tools');
  mkdirSync(bin);
  writeFileSync(join(bin, 'systemd-run'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CALLS"\n', { mode: 0o755 });
  const result = f.run('backup', [], { PATH: `${bin}:${process.env.PATH}` }, true);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const args = readFileSync(f.calls, 'utf8').split('\n');
  assert.ok(args.some(arg => arg.startsWith('--property=StandardOutput=append:')));
  assert.ok(args.includes('--foreground'));
  assert.ok(args.includes('backup'));
});
