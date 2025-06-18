import { expect, test } from '@playwright/test';
import { createRsbuild } from '@rsbuild/core';
import { pluginAssetsRetry } from '../../dist';

const createDevServer = async () => {
  const rsbuild = await createRsbuild({
    cwd: import.meta.dirname,
    rsbuildConfig: {
      plugins: [pluginAssetsRetry()],
      html: {
        template: './index.html',
      },
    },
  });
  return rsbuild.startDevServer();
};

test('should allow empty src and not cause the white screen', async ({
  page,
}) => {
  const rsbuild = await createDevServer();
  await page.goto(`http://localhost:${rsbuild.port}`);

  const root = await page.$('#root');

  expect(await root?.innerHTML()).toBe('some content');
});
