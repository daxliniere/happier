import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, symlink, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const project = resolve(here, '../../../..');
for (const version of ['0.2.20-fork.3', '0.2.20-beta1.4', 'invalid']) {
  test(`deployment bookkeeping: ${version}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-deploy-version-'));
    try {
      await copyFile(join(here, 'deploy-installed-metadata.mjs'), join(root, 'helper.mjs'));
      await symlink(join(project, 'worktrees'), join(root, 'worktrees'));
      await mkdir(join(root, 'ui'));
      await writeFile(join(root, 'ui/index.html'), '<html>fixture</html>');
      const previous = JSON.stringify({ version: 'previous', uiDeploymentId: 'previous_identity_123' });
      await writeFile(join(root, 'state.json'), previous);
      await writeFile(join(root, 'relay.service'), 'Environment=HAPPIER_SERVER_UI_DEPLOYMENT_ID=previous_identity_123\n');
      const args = [join(root, 'helper.mjs'), 'install', join(root, 'state.json'), join(root, 'ui'), join(root, 'relay.service'), version];
      const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
      if (version === 'invalid') {
        assert.notEqual(result.status, 0);
        assert.equal(await readFile(join(root, 'state.json'), 'utf8'), previous);
        return;
      }
      assert.equal(result.status, 0, result.stderr);
      const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
      assert.equal(state.version, `happier-server-v${version}-linux-x64`);
      assert.match(state.uiDeploymentDigest, /^sha256:[a-f0-9]{64}$/);
      assert.equal(await readFile(join(root, 'relay.service'), 'utf8'), `Environment=HAPPIER_SERVER_UI_DEPLOYMENT_ID=${state.uiDeploymentId}\n`);
      const restored = spawnSync(process.execPath, [args[0], 'restore', ...args.slice(2, 5)], { encoding: 'utf8' });
      assert.equal(restored.status, 0, restored.stderr);
      assert.equal(JSON.parse(await readFile(join(root, 'state.json'), 'utf8')).uiDeploymentId, state.uiDeploymentId);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
