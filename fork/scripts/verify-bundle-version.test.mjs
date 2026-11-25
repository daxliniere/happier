import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const verifier = fileURLToPath(new URL('./verify-bundle-version.mjs', import.meta.url));

// A web export embeds Expo's config as JSON that is string-escaped inside the JS bundle.
const webBundle = (version, release) =>
  `var a="{\\"app\\":{\\"variant\\":\\"development\\",\\"forkVersion\\":\\"${version}\\",\\"forkRelease\\":\\"${release}\\"}}";`;

function uiDir(t, ...bundles) {
  const root = mkdtempSync(join(tmpdir(), 'verify-bundle-version-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, '_expo/static/js/web');
  mkdirSync(dir, { recursive: true });
  bundles.forEach((text, index) => writeFileSync(join(dir, `index-${index}.js`), text));
  return root;
}
const run = (args) => spawnSync(process.execPath, [verifier, ...args], { encoding: 'utf8' });

test('accepts a web bundle whose embedded label matches the expected version and release', t => {
  const dir = uiDir(t, webBundle('0.2.21-beta1.5', '0.2.21-beta1.5'));
  const result = run(['--expect-version', '0.2.21-beta1.5', '--expect-release', '0.2.21-beta1.5', '--ui-dir', dir]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('rejects the stale label that beta1.4 shipped from a reused bundler cache', t => {
  const dir = uiDir(t, webBundle('0.2.19-fork.39', 'rc5'));
  const result = run(['--expect-version', '0.2.21-beta1.5', '--expect-release', '0.2.21-beta1.5', '--ui-dir', dir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forkVersion is 0\.2\.19-fork\.39 \(expected 0\.2\.21-beta1\.5\)/);
  assert.match(result.stderr, /forkRelease is rc5/);
});

test('rejects a bundle that mixes an old and a new label, since either could be what the app reads', t => {
  const dir = uiDir(t, webBundle('0.2.21-beta1.5', '0.2.21-beta1.5'), webBundle('0.2.19-fork.39', 'rc5'));
  const result = run(['--expect-version', '0.2.21-beta1.5', '--ui-dir', dir]);
  assert.notEqual(result.status, 0);
});

test('rejects a bundle with no embedded label at all instead of passing silently', t => {
  const dir = uiDir(t, 'var nothing = 1;');
  const result = run(['--expect-version', '0.2.21-beta1.5', '--ui-dir', dir]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /forkVersion not found/);
});

test('--expect-version alone does not check the release label', t => {
  const dir = uiDir(t, webBundle('0.2.21-beta1.5', 'anything'));
  const result = run(['--expect-version', '0.2.21-beta1.5', '--ui-dir', dir]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
