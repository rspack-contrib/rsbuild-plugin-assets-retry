import { expect, test } from '@playwright/test';
import { createRsbuild } from '@rsbuild/core';
import { pluginAssetsRetry, ASSETS_RETRY_DATA_ATTRIBUTE } from '../../dist';

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

  // 检查内联脚本是否有正确的 data 属性
  const inlineScript = await page.locator(`script[${ASSETS_RETRY_DATA_ATTRIBUTE}="inline"]`);
  expect(await inlineScript.count()).toBe(1);

  // 验证脚本内容包含重试逻辑
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

  // 检查外部脚本是否有正确的 data 属性
  const externalScript = await page.locator(`script[${ASSETS_RETRY_DATA_ATTRIBUTE}="external"]`);
  expect(await externalScript.count()).toBe(1);

  // 验证脚本有 src 属性
  const src = await externalScript.getAttribute('src');
  expect(src).toContain('assets-retry');

  await server.close();
});

test('should be able to filter retry script in HTML template', async ({ page }) => {
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

  // 模拟在 HTML 模板中使用 htmlWebpackPlugin.tags.headTags.filter 的场景
  // 验证可以通过 data 属性筛选出重试脚本
  const allScripts = await page.locator('script');
  const retryScripts = await page.locator(`script[${ASSETS_RETRY_DATA_ATTRIBUTE}]`);

  const allScriptsCount = await allScripts.count();
  const retryScriptsCount = await retryScripts.count();

  // 应该有至少一个脚本，且重试脚本应该是其中的一个
  expect(allScriptsCount).toBeGreaterThan(0);
  expect(retryScriptsCount).toBe(1);

  await server.close();
});
