import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { type RsbuildPlugin, logger } from '@rsbuild/core';
import { defineConfig } from '@rslib/core';
import { minify } from '@swc/core';
import pkgJson from './package.json';

/**
 * Compile runtime code to ES5
 */
const pluginCompileRuntime: RsbuildPlugin = {
  name: 'rsbuild-plugin-compile-runtime',
  setup(api) {
    /**
     * transform `src/runtime/${filename}.ts`
     * to `dist/runtime/${filename}.js` and `dist/runtime/${filename}.min.js`
     */
    async function minifyRuntimeFile(filename: string) {
      const distPath = path.join(
        api.context.distPath,
        'runtime',
        `${filename}.js`,
      );
      const distCode = await readFile(distPath, 'utf8');
      const distMinPath = path.join(
        api.context.distPath,
        'runtime',
        `${filename}.min.js`,
      );

      const { code: minifiedRuntimeCode } = await minify(distCode, {
        ecma: 5,
        // allows SWC to mangle function names
        module: true,
      });

      await writeFile(distMinPath, minifiedRuntimeCode);
    }

    api.onAfterBuild(async () => {
      const startTime = performance.now();
      const runtimeDir = path.join(api.context.distPath, 'runtime');

      if (!existsSync(runtimeDir)) {
        await mkdir(runtimeDir);
      }

      await Promise.all([
        minifyRuntimeFile('initialChunkRetry'),
        minifyRuntimeFile('asyncChunkRetry'),
      ]);

      logger.success(
        `compiled assets retry runtime code in ${(
          performance.now() - startTime
        ).toFixed(1)} ms`,
      );
    });
  },
};

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
    },
    {
      format: 'iife',
      syntax: 'es5',
      source: {
        entry: {
          'runtime/asyncChunkRetry': 'src/runtime/asyncChunkRetry.ts',
        },
      },
    },
  ],
  source: {
    define: {
      PLUGIN_VERSION: JSON.stringify(pkgJson.version.replace(/\./g, '-')),
    },
  },
  plugins: [pluginCompileRuntime],
});
