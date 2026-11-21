import { expect, test } from '@playwright/test';

import { startServerLight } from '../../src/testkit/process/serverLight';
import { startUiWeb } from '../../src/testkit/process/uiWeb';
import { createRunDirs } from '../../src/testkit/runDir';
import { appendBrowserDiagnostics, collectBrowserDiagnostics } from '../../src/testkit/uiE2e/browserDiagnostics';
import { ensureAccountReadyForConnect } from '../../src/testkit/uiE2e/ensureAccountReadyForConnect';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';

test('restores a hidden provider model after reopening Settings and can reset visibility', async ({ page }) => {
    test.setTimeout(540_000);
    const run = createRunDirs({ runLabel: 'ui-e2e' });
    const testDir = run.testDir('settings-model-visibility');
    const server = await startServerLight({ testDir, dbProvider: 'sqlite' });
    try {
        const ui = await startUiWeb({
            testDir,
            env: {
                ...process.env,
                EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
                EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-model-visibility-${run.runId}`,
            },
        });
        try {
            const diagnostics = collectBrowserDiagnostics({ page });
            try {
                const base = normalizeLoopbackBaseUrl(ui.baseUrl);
                await gotoDomContentLoadedWithRetries(page, `${base}/?happier_hmr=0`, 180_000);
                await waitForInitialAppUi({ page, timeoutMs: 180_000 });
                await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });

                const openGeminiModels = async () => {
                    await gotoDomContentLoadedWithRetries(page, `${base}/settings/providers?happier_hmr=0`, 90_000);
                    await page.getByTestId('settings-model-visibility').click();
                    await page.getByTestId('model-visibility-provider').click();
                    await page.getByTestId('model-visibility-provider:agent:gemini').click();
                };
                const model = page.getByTestId('model-visibility-switch:gemini-2.5-pro');

                await openGeminiModels();
                await expect(model).toHaveAttribute('aria-checked', 'true');
                await model.click();
                await expect(model).toHaveAttribute('aria-checked', 'false');

                await openGeminiModels();
                await expect(model).toHaveAttribute('aria-checked', 'false');
                await model.click();
                await expect(model).toHaveAttribute('aria-checked', 'true');

                await model.click();
                await expect(model).toHaveAttribute('aria-checked', 'false');
                const showAll = page.getByTestId('model-visibility-show-all');
                await expect(showAll).toBeEnabled();
                await showAll.click();
                await expect(model).toHaveAttribute('aria-checked', 'true');
            } catch (error) {
                throw appendBrowserDiagnostics(error, diagnostics());
            }
        } finally {
            await ui.stop();
        }
    } finally {
        await server.stop();
    }
});
