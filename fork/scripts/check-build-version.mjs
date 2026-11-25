#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? process.cwd());
const readText = relativePath => readFileSync(resolve(root, relativePath), 'utf8').trim();
const version = readText('fork/VERSION');
const release = readText('fork/RELEASE');
const generated = JSON.parse(readText('fork/build-version.json'));
const cliPackage = JSON.parse(readText('apps/cli/package.json'));

const errors = [];
if (!version || !release) {
  errors.push('fork/VERSION and fork/RELEASE must both be non-empty');
}
if (version && release && version !== release) {
  errors.push('fork/RELEASE must equal fork/VERSION (the label shows one number; a different release text is drift)');
}
if (generated.version !== version || generated.release !== release) {
  errors.push('fork/build-version.json must match fork/VERSION and fork/RELEASE');
}
if (cliPackage.happierForkVersion !== version || cliPackage.happierForkRelease !== release) {
  errors.push('apps/cli/package.json fork metadata must match fork/VERSION and fork/RELEASE');
}

if (errors.length > 0) {
  console.error(`Fork build metadata is inconsistent:\n- ${errors.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`Fork build ${version} metadata checks passed`);
}
