#!/usr/bin/env node
// Fails unless the fork version text baked into a built artifact equals fork/VERSION and fork/RELEASE.
// The web export embeds Expo's computed app config. Metro caches that module by its code, not by what
// apps/ui/app.config.js computed, so a reused cache can silently ship an old version label (seen
// 2026-11-24: beta1.4 served 0.2.19-fork.39 / rc5). Builds must prove the label before it is shipped.
//
//   verify-bundle-version.mjs (--repo CHECKOUT | --expect-version V [--expect-release R])
//       [--server-archive FILE.tar.gz] [--apk FILE.apk] [--ui-dir DIR]
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};
// Expected values come from a checkout (--repo) or are given directly (--expect-version, used by the
// install gate, which has an archive and a version but no checkout). --expect-version alone skips the
// release check; add --expect-release to check it too.
const explicitVersion = option('--expect-version');
const explicitRelease = option('--expect-release');
const repo = resolve(option('--repo') ?? process.cwd());
const readText = file => readFileSync(join(repo, file), 'utf8').trim();
const expected = explicitVersion
  ? { forkVersion: explicitVersion, ...(explicitRelease ? { forkRelease: explicitRelease } : {}) }
  : { forkVersion: readText('fork/VERSION'), forkRelease: readText('fork/RELEASE') };

const BIG = { maxBuffer: 1024 * 1024 * 1024 };
// Matches forkVersion":"x" in plain JSON and in JSON that was string-escaped inside a JS bundle.
const valuePattern = key => new RegExp(`${key}\\\\*"\\s*:\\s*\\\\*"([^"\\\\]+)`, 'g');

function collect(text, found) {
  for (const key of Object.keys(found)) {
    for (const match of text.matchAll(valuePattern(key))) found[key].add(match[1]);
  }
}

function listWebBundles(dir) {
  const jsDir = join(dir, '_expo', 'static', 'js', 'web');
  if (!existsSync(jsDir)) return [];
  return readdirSync(jsDir).filter(name => name.endsWith('.js')).map(name => join(jsDir, name));
}

const targets = [];
const archive = option('--server-archive');
if (archive) {
  // One decompression pass: the server archive is large.
  targets.push({
    label: `${archive} (web app)`,
    read: () => {
      const text = execFileSync(
        'tar',
        ['-xzOf', archive, '--wildcards', '*ui-web/current/_expo/static/js/web/*.js'],
        { ...BIG, encoding: 'utf8' },
      );
      if (!text) throw new Error(`No web bundle found inside ${archive}`);
      return text;
    },
  });
}
const uiDir = option('--ui-dir');
if (uiDir) {
  const bundles = listWebBundles(resolve(uiDir));
  if (bundles.length === 0) throw new Error(`No web bundle found in ${uiDir}`);
  targets.push({ label: `${uiDir} (web app)`, read: () => bundles.map(file => readFileSync(file, 'utf8')).join('\n') });
}
const apk = option('--apk');
if (apk) {
  targets.push({
    label: `${apk} (app.config)`,
    read: () => execFileSync('unzip', ['-p', apk, 'assets/app.config'], { ...BIG, encoding: 'utf8' }),
  });
}
if (targets.length === 0) {
  console.error('Give at least one of --server-archive, --ui-dir or --apk');
  process.exit(2);
}

let failed = false;
for (const target of targets) {
  if (!existsSync(target.label.split(' (')[0])) throw new Error(`Missing: ${target.label}`);
  const found = Object.fromEntries(Object.keys(expected).map(key => [key, new Set()]));
  collect(target.read(), found);
  const problems = [];
  for (const [key, want] of Object.entries(expected)) {
    const values = [...found[key]];
    if (values.length === 0) problems.push(`${key} not found (expected ${want})`);
    else if (values.length !== 1 || values[0] !== want) problems.push(`${key} is ${values.join(', ')} (expected ${want})`);
  }
  if (problems.length > 0) {
    failed = true;
    console.error(`VERSION MISMATCH in ${target.label}:\n- ${problems.join('\n- ')}`);
  } else {
    console.log(`OK ${target.label}: ${Object.values(expected).join(' / ')}`);
  }
}
if (failed) process.exit(1);
