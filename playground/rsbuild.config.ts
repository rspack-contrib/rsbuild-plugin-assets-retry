import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginAssetsRetry } from '../dist';

export default defineConfig({
  plugins: [pluginAssetsRetry(), pluginReact()],
});
