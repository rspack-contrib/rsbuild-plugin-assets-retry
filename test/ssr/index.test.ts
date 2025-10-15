import { expect, test } from '@playwright/test';
import { createRsbuild, type RsbuildPlugin } from '@rsbuild/core';
import rsbuildConfig from './rsbuild.config';

const testPlugin = {
  setup(api) {
    api.processAssets({ stage: 'optimize' }, ({ assets, environment }) => {
      if(environment.name === 'web') {
        expect(assets['static/js/index.js'].source().toString()).toContain('registerAsyncChunkRetry');
      } else {
        const files = Object.keys(assets).sort();
        expect(files.length).toEqual(1);
      }
    });
  },
} as RsbuildPlugin;

const build = async () => {
  const rsbuild = await createRsbuild({
    cwd: import.meta.dirname,
    rsbuildConfig: {
      ...rsbuildConfig,
      plugins: [...(rsbuildConfig.plugins || []), testPlugin],
    },
  });
  await rsbuild.build();
};

test('should not work in node environment and only work in web environment', async () => {
  await build();
});
