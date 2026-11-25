import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const checker = fileURLToPath(new URL('./check-build-version.mjs', import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fork-build-version-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (relative, contents) => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  };
  write('fork/VERSION', '0.2.20-beta1.7\n');
  write('fork/RELEASE', '0.2.20-beta1.7\n');
  write('fork/build-version.json', '{"version":"0.2.20-beta1.7","release":"0.2.20-beta1.7"}\n');
  write('apps/cli/package.json', '{"happierForkVersion":"0.2.20-beta1.7","happierForkRelease":"0.2.20-beta1.7"}\n');
  return { root, write };
}

test('accepts the fork build and base release when every build input agrees', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [checker, f.root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects stale CLI package metadata before a build can ship the wrong label', t => {
  const f = fixture(t);
  f.write('apps/cli/package.json', '{"happierForkVersion":"0.2.20-beta1.6","happierForkRelease":"0.2.20-beta1.7"}\n');
  const result = spawnSync(process.execPath, [checker, f.root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /apps\/cli\/package\.json/);
});

test('rejects a stale base release label in the CLI package metadata', t => {
  const f = fixture(t);
  f.write('apps/cli/package.json', '{"happierForkVersion":"0.2.20-beta1.7","happierForkRelease":"0.2.20-beta1.6"}\n');
  const result = spawnSync(process.execPath, [checker, f.root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /apps\/cli\/package\.json/);
});

test('rejects generated metadata that disagrees with the selected base release', t => {
  const f = fixture(t);
  f.write('fork/build-version.json', '{"version":"0.2.20-beta1.7","release":"0.2.20-beta1.6"}\n');
  const result = spawnSync(process.execPath, [checker, f.root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fork\/build-version\.json/);
});

test('rejects a release label that differs from the build version so the two cannot drift', t => {
  const f = fixture(t);
  f.write('fork/RELEASE', '0.2.20-beta1.6\n');
  f.write('fork/build-version.json', '{"version":"0.2.20-beta1.7","release":"0.2.20-beta1.6"}\n');
  f.write('apps/cli/package.json', '{"happierForkVersion":"0.2.20-beta1.7","happierForkRelease":"0.2.20-beta1.6"}\n');
  const result = spawnSync(process.execPath, [checker, f.root], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fork\/RELEASE must equal fork\/VERSION/);
});

test('the version bump moves fork/RELEASE and every generated copy to the new build together', t => {
  const f = fixture(t);
  const bump = fileURLToPath(new URL('./bump-version.sh', import.meta.url));
  mkdirSync(join(f.root, 'fork/scripts'), { recursive: true });
  copyFileSync(bump, join(f.root, 'fork/scripts/bump-version.sh'));
  f.write('fork/VERSION', '0.2.20-beta1.7\n');
  const bumped = spawnSync('bash', [join(f.root, 'fork/scripts/bump-version.sh')], { encoding: 'utf8' });
  assert.equal(bumped.status, 0, bumped.stdout + bumped.stderr);
  assert.equal(readFileSync(join(f.root, 'fork/VERSION'), 'utf8').trim(), '0.2.20-beta1.8');
  assert.equal(readFileSync(join(f.root, 'fork/RELEASE'), 'utf8').trim(), '0.2.20-beta1.8');
  const checked = spawnSync(process.execPath, [checker, f.root], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});
