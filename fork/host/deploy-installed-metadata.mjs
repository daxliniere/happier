import { randomUUID } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { computeUiDeploymentDigest, resolveUiDeploymentIdentity } from './worktrees/rc2/packages/cli-common/dist/firstPartyRuntime/uiDeploymentIdentity.js';

// Installation bookkeeping only. Use the runtime's canonical UI identity owner.
const [mode, stateFile, uiDirectory, unitFile, version] = process.argv.slice(2);
if (!['install', 'restore'].includes(mode) || !stateFile || !unitFile) {
  throw new Error('Expected install|restore STATE_FILE UI_DIRECTORY UNIT_FILE [FORK_VERSION]');
}
const previousStateText = await readFile(stateFile, 'utf8');
const state = JSON.parse(previousStateText);
if (mode === 'install') {
  if (!/^0\.2\.\d+-(?:fork\.\d+|beta\d+\.\d+)$/.test(version ?? '')) throw new Error('Invalid fork version');
  const identity = resolveUiDeploymentIdentity({
    digest: await computeUiDeploymentDigest(uiDirectory), previousStateText, generateId: randomUUID,
  });
  state.uiDeploymentDigest = identity.digest;
  state.uiDeploymentId = identity.deploymentId;
  state.version = `happier-server-v${version}-linux-x64`;
  state.updatedAt = new Date().toISOString();
}
if (!/^[A-Za-z0-9_-]{16,128}$/.test(state.uiDeploymentId ?? '')) {
  throw new Error('Missing or invalid restored UI deployment identity');
}
const unit = await readFile(unitFile, 'utf8');
const identityLine = /^Environment=HAPPIER_SERVER_UI_DEPLOYMENT_ID=.*$/gm;
if ([...unit.matchAll(identityLine)].length !== 1) throw new Error('Expected one UI identity in relay unit');
const updatedUnit = unit.replace(identityLine, `Environment=HAPPIER_SERVER_UI_DEPLOYMENT_ID=${state.uiDeploymentId}`);
async function replaceFile(path, contents) {
  const mode = (await stat(path)).mode & 0o777;
  const temporary = `${path}.deploy-${process.pid}`;
  await writeFile(temporary, contents, { mode, flag: 'wx' });
  await rename(temporary, path);
}
await replaceFile(unitFile, updatedUnit);
if (mode === 'install') await replaceFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(`${mode}: ${state.version}; UI deployment ${state.uiDeploymentId}`);
