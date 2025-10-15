import { defineConfig } from '@rsbuild/core';
import { pluginAssetsRetry } from '@rsbuild/plugin-assets-retry';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginAssetsRetry({
      domain: ['http://localhost:3000', 'http://localhost:3001'],
      inlineScript: false,
    }),
  ],
  environments: {
    node: {
      output: {
        target: 'node',
        distPath: {
          root: 'dist/server',
        },
      },
      source: {
        entry: {
          index: './index.server.js',
        },
      },
    },
    web: {
      source: {
        entry: {
          index: './index.client.js',
        },
      },
      output: {
        minify: false,
        filenameHash: false,
      },
    },
  },
  tools: {
    htmlPlugin: false,
  },
});
