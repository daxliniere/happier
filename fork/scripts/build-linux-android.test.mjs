import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const runner = fileURLToPath(new URL('./build-linux-android.sh', import.meta.url));
// Compiler processes are OS boundaries. The real runner, artifact collection,
// checksum verification and exit-status handling execute without internal mocks.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fork-build-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'checkout with spaces');
  const bin = join(root, 'tools');
  const put = (path, contents, executable = false) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, { mode: executable ? 0o755 : 0o644 });
  };
  put(join(repo, 'fork/VERSION'), '0.2.20-fork.32\n');
  put(join(repo, 'fork/RELEASE'), '0.2.20-fork.32\n');
  put(join(repo, 'fork/build-version.json'), '{"version":"0.2.20-fork.32","release":"0.2.20-fork.32"}');
  put(join(repo, 'apps/cli/package.json'), '{"happierForkVersion":"0.2.20-fork.32","happierForkRelease":"0.2.20-fork.32"}');
  put(join(repo, 'fork/scripts/check-build-version.mjs'), readFileSync(new URL('./check-build-version.mjs', import.meta.url), 'utf8'));
  put(join(repo, 'fork/scripts/verify-bundle-version.mjs'), readFileSync(new URL('./verify-bundle-version.mjs', import.meta.url), 'utf8'));
  put(join(repo, 'package.json'), '{}');
  put(join(repo, '.gitignore'), 'dist/\nnode_modules/\n');
  mkdirSync(join(repo, 'node_modules'), { recursive: true });
  put(join(bin, 'bun'), '#!/bin/sh\necho 1.4.4\n', true);
  put(join(bin, 'yarn'), `#!/usr/bin/env bash
set -eu
echo "$*" >> "$CALLS"
echo "$TMPDIR" >> "$CALLS.tmpdir"
case "$*" in
  *release:build:binaries:server*)
    [ "\$FAIL_SERVER" != 1 ] || exit 19
    dir=server; product=happier-server ;;
  *release:build:binaries:cli*) dir=cli; product=happier ;;
  *) exit 0 ;;
esac
[ "\$STALE_ONLY" != 1 ] || exit 0
mkdir -p "dist/release-assets/\$dir"
label=\$(cat fork/VERSION); [ "\$STALE_LABEL" != 1 ] || label=0.2.19-fork.39
stage=\$(mktemp -d); top="\$stage/\$product-v0.2.17-linux-x64"; mkdir -p "\$top/ui-web/current/_expo/static/js/web"
printf 'var a="{\\\\"app\\\\":{\\\\"forkVersion\\\\":\\\\"%s\\\\",\\\\"forkRelease\\\\":\\\\"%s\\\\"}}";' "\$label" "\$label" > "\$top/ui-web/current/_expo/static/js/web/index-test.js"
tar -czf "dist/release-assets/\$dir/\$product-v0.2.17-linux-x64.tar.gz" -C "\$stage" "\$product-v0.2.17-linux-x64"
rm -rf "\$stage"
(cd "dist/release-assets/\$dir" && sha256sum *.tar.gz > "checksums-\$product-v0.2.17.txt")
`, true);
  put(join(repo, 'fork/scripts/android-build.sh'), `#!/usr/bin/env bash
set -eu
echo android >> "$CALLS"
mkdir -p "$HAPPIER_FORK_BUILDS_DIR/android-test"
label=$(cat fork/VERSION); [ "$STALE_LABEL" != 1 ] || label=0.2.19-fork.39
python3 -I -c 'import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("assets/app.config", "{\\"extra\\":{\\"app\\":{\\"forkVersion\\":\\"%s\\",\\"forkRelease\\":\\"%s\\"}}}" % (sys.argv[2], sys.argv[2])); z.close()' "$HAPPIER_FORK_BUILDS_DIR/android-test/Sadder-debugsigned.apk" "$label"
printf aab > "$HAPPIER_FORK_BUILDS_DIR/android-test/Sadder-upload-signed.aab"
`, true);
  put(join(root, 'jdk/bin/java'), '#!/bin/sh\nexit 0\n', true);
  put(join(root, 'jdk/bin/jarsigner'), '#!/bin/sh\nexit 0\n', true);
  put(join(root, 'sdk/build-tools/36.0.0/apksigner'), '#!/bin/sh\nexit 0\n', true);
  put(join(root, 'keys/sadder-upload.p12'), 'fixture');
  put(join(root, 'keys/sadder-upload.password'), 'fixture');
  spawnSync('git', ['init', '-q', repo]);
  spawnSync('git', ['-C', repo, 'add', '.']);
  spawnSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture']);
  const output = join(root, 'output');
  const calls = join(root, 'calls');
  const run = (extraEnv = {}, args = []) => spawnSync('bash', [runner, '--repo', repo, '--output', output, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls,
      JAVA_HOME: join(root, 'jdk'), ANDROID_HOME: join(root, 'sdk'), SADDER_KEY_DIR: join(root, 'keys'),
      FAIL_SERVER: '0', STALE_ONLY: '0', STALE_LABEL: '0', ...extraEnv },
  });
  return { repo, output, calls, bin, put, run };
}

test('one invocation produces all deliverables, logs and verifiable checksums', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const name of ['server/happier-server-v0.2.17-linux-x64.tar.gz',
    'cli/happier-v0.2.17-linux-x64.tar.gz', 'android/android-test/Sadder-debugsigned.apk',
    'android/android-test/Sadder-upload-signed.aab', 'logs/server.log', 'logs/cli.log', 'logs/android.log']) {
    assert.ok(existsSync(join(f.output, name)), name);
  }
  assert.equal(spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: f.output }).status, 0);
  assert.match(readFileSync(join(f.output, 'RESULT.txt'), 'utf8'), /SUCCESS/);
});

test('a failed server does not suppress independent CLI/Android builds or report success', t => {
  const f = fixture(t);
  const result = f.run({ FAIL_SERVER: '1' });
  assert.notEqual(result.status, 0);
  assert.match(readFileSync(f.calls, 'utf8'), /release:build:binaries:cli/);
  assert.match(readFileSync(f.calls, 'utf8'), /android/);
  assert.ok(existsSync(join(f.output, 'android/android-test/Sadder-debugsigned.apk')));
  assert.match(readFileSync(join(f.output, 'RESULT.txt'), 'utf8'), /FAILED/);
});

test('old archives cannot satisfy a successful compiler that produced nothing', t => {
  const f = fixture(t);
  mkdirSync(join(f.repo, 'dist/release-assets/server'), { recursive: true });
  writeFileSync(join(f.repo, 'dist/release-assets/server/happier-server-v0.2.17-linux-x64.tar.gz'), 'old');
  const result = f.run({ STALE_ONLY: '1' });
  assert.notEqual(result.status, 0);
  assert.ok(!existsSync(join(f.output, 'server/happier-server-v0.2.17-linux-x64.tar.gz')));
  assert.match(readFileSync(join(f.output, 'RESULT.txt'), 'utf8'), /FAILED artifact freshness/);
});

test('version mismatch refuses before any compiler starts', t => {
  const f = fixture(t);
  f.put(join(f.repo, 'fork/build-version.json'), '{"version":"0.2.20-fork.31","release":"rc4"}');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /fork\/build-version\.json must match/);
  assert.ok(!existsSync(f.calls));
});

test('stale CLI label metadata refuses before any compiler starts', t => {
  const f = fixture(t);
  f.put(join(f.repo, 'apps/cli/package.json'), '{"happierForkVersion":"0.2.20-fork.31","happierForkRelease":"rc4"}');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /apps\/cli\/package\.json/);
  assert.ok(!existsSync(f.calls));
});

test('beta build labels are accepted by the release prerequisite check', t => {
  const f = fixture(t);
  f.put(join(f.repo, 'fork/VERSION'), '0.2.20-beta1.4\n');
  f.put(join(f.repo, 'fork/RELEASE'), '0.2.20-beta1.4\n');
  f.put(join(f.repo, 'fork/build-version.json'), '{"version":"0.2.20-beta1.4","release":"0.2.20-beta1.4"}');
  f.put(join(f.repo, 'apps/cli/package.json'), '{"happierForkVersion":"0.2.20-beta1.4","happierForkRelease":"0.2.20-beta1.4"}');
  spawnSync('git', ['-C', f.repo, 'add', '.']);
  spawnSync('git', ['-C', f.repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'beta label']);
  const result = f.run({}, ['--check']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(!existsSync(f.calls));
});

test('detached launch preserves the selected checkout and output as separate arguments', t => {
  const f = fixture(t);
  f.put(join(f.bin, 'systemd-run'), '#!/bin/sh\nprintf "%s\\n" "$@" > "$CALLS"\n', true);
  const result = f.run({}, ['--detach']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const args = readFileSync(f.calls, 'utf8').split('\n');
  assert.ok(args.includes(`--working-directory=${f.repo}`));
  assert.equal(args[args.indexOf('--repo') + 1], f.repo);
  assert.equal(args[args.indexOf('--output') + 1], f.output);
  assert.ok(!existsSync(f.output));
});

test('a stale version label in the web app or the APK fails the whole build instead of shipping', t => {
  const f = fixture(t);
  const result = f.run({ STALE_LABEL: '1' });
  assert.notEqual(result.status, 0);
  const summary = readFileSync(join(f.output, 'RESULT.txt'), 'utf8');
  assert.match(summary, /server: FAILED embedded version label check/);
  assert.match(summary, /android: FAILED embedded version label check/);
  assert.match(summary, /\nFAILED\n/);
});

test('every build gets its own bundler cache directory and removes it afterwards', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const dirs = [...new Set(readFileSync(`${f.calls}.tmpdir`, 'utf8').trim().split('\n'))];
  assert.equal(dirs.length, 1);
  assert.match(dirs[0], /dist\/fork-cache\/build-tmp\./);
  assert.equal(existsSync(dirs[0]), false, 'the per-build temp dir must be removed');
});
