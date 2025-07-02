import { expect, test } from '@playwright/test';
import { createRsbuild } from '@rsbuild/core';
import { ASSETS_RETRY_DATA_ATTRIBUTE, pluginAssetsRetry } from '../../dist';

test('should add data attribute to inline retry script', async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: import.meta.dirname,
    rsbuildConfig: {
      plugins: [
        pluginAssetsRetry({
          inlineScript: true,
        }),
      ],
    },
  });

  const { server, urls } = await rsbuild.startDevServer();

  await page.goto(urls[0]);

  // Check if inline script has correct data attribute
  const inlineScript = await page.locator(
    `script[${ASSETS_RETRY_DATA_ATTRIBUTE}="inline"]`,
  );
  expect(await inlineScript.count()).toBe(1);

  // Verify script content contains retry logic
  const scriptContent = await inlineScript.innerHTML();
  expect(scriptContent).toContain('document.addEventListener');

  await server.close();
});

test('should add data attribute to external retry script', async ({ page }) => {
  const rsbuild = await createRsbuild({
    cwd: import.meta.dirname,
    rsbuildConfig: {
      plugins: [
        pluginAssetsRetry({
          inlineScript: false,
        }),
      ],
    },
  });

  const { server, urls } = await rsbuild.startDevServer();

  await page.goto(urls[0]);

  // Check if external script has correct data attribute
  const externalScript = await page.locator(
    `script[${ASSETS_RETRY_DATA_ATTRIBUTE}="external"]`,
  );
  expect(await externalScript.count()).toBe(1);

  // Verify script has src attribute
  const src = await externalScript.getAttribute('src');
  expect(src).toContain('assets-retry');

  await server.close();
});

test('should be able to filter retry script in HTML template', async ({
  page,
}) => {
  const rsbuild = await createRsbuild({
    cwd: import.meta.dirname,
    rsbuildConfig: {
      plugins: [
        pluginAssetsRetry({
          inlineScript: true,
        }),
      ],
    },
  });

  const { server, urls } = await rsbuild.startDevServer();

  await page.goto(urls[0]);

  // Simulate using htmlWebpackPlugin.tags.headTags.filter in HTML template
  // Verify that retry scripts can be filtered by data attribute
  const allScripts = await page.locator('script');
  const retryScripts = await page.locator(
    `script[${ASSETS_RETRY_DATA_ATTRIBUTE}]`,
  );

  const allScriptsCount = await allScripts.count();
  const retryScriptsCount = await retryScripts.count();

  // Should have at least one script, and retry script should be one of them
  expect(allScriptsCount).toBeGreaterThan(0);
  expect(retryScriptsCount).toBe(1);

  await server.close();
});
