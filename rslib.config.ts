import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { type RsbuildPlugin, logger } from '@rsbuild/core';
import { defineConfig } from '@rslib/core';
import { minify } from '@swc/core';
import pkgJson from './package.json';

/**
 * Compile runtime code to ES5
 */
const pluginGenerateMinified: (filename: string) => RsbuildPlugin = (
  filename: string,
) => ({
  name: 'rsbuild-plugin-compile-runtime',
  setup(api) {
    /**
     * transform `src/runtime/${filename}.ts`
     * to `dist/runtime/${filename}.js` and `dist/runtime/${filename}.min.js`
     */
    async function minifyRuntimeFile(distCode: string) {
      const startTime = performance.now();
      const { code: minifiedRuntimeCode } = await minify(distCode, {
        ecma: 5,
        // allows SWC to mangle function names
        module: true,
        compress: {
          passes: 5,
          unsafe: true,
        },
      });

      logger.success(
        `minify ${filename} retry runtime code in ${(
          performance.now() - startTime
        ).toFixed(1)} ms`,
      );
      return minifiedRuntimeCode;
    }

    api.processAssets(
      { stage: 'optimize-transfer' },
      async ({ assets, compilation, compiler }) => {
        const minifiedChunkFilePath = path.join(
          'runtime',
          `${filename}.min.js`,
        );

        await Promise.all(
          Object.entries(assets).map(async ([_, assetSource]) => {
            const code = assetSource.source().toString();
            const minifiedCode = await minifyRuntimeFile(code);
            compilation.emitAsset(
              minifiedChunkFilePath,
              new compiler.webpack.sources.RawSource(minifiedCode),
            );
          }),
        );
      },
    );
  },
});

export default defineConfig({
  lib: [
    {
      format: 'esm',
      syntax: 'es2021',
      dts: {
        bundle: true,
      },
      source: {
        entry: {
          index: 'src/index.ts',
        },
      },
    },
    {
      format: 'cjs',
      syntax: 'es2021',
      source: {
        entry: {
          index: 'src/index.ts',
        },
      },
    },
    {
      format: 'iife',
      syntax: 'es5',
      source: {
        entry: {
          'runtime/initialChunkRetry': 'src/runtime/initialChunkRetry.ts',
        },
      },
      output: {
        target: 'web',
      },
      plugins: [pluginGenerateMinified('initialChunkRetry')],
    },
    {
      format: 'iife',
      syntax: 'es5',
      source: {
        entry: {
          'runtime/asyncChunkRetry': 'src/runtime/asyncChunkRetry.ts',
        },
      },
      output: {
        target: 'web',
      },
      plugins: [pluginGenerateMinified('asyncChunkRetry')],
    },
  ],
  source: {
    define: {
      PLUGIN_VERSION: JSON.stringify(pkgJson.version.replace(/\./g, '-')),
    },
  },
});
