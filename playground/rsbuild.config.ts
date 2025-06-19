import { defineConfig } from '@rsbuild/core';
import { pluginAssetsRetry } from '../dist';

export default defineConfig({
  plugins: [pluginAssetsRetry()],
});
