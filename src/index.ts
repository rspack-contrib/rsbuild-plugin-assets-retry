import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  EnvironmentContext,
  NormalizedEnvironmentConfig,
  RsbuildPlugin,
} from '@rsbuild/core';
import { ensureAssetPrefix } from '@rsbuild/core';
import serialize from 'serialize-javascript';
import { AsyncChunkRetryPlugin } from './AsyncChunkRetryPlugin.js';
import type {
  NormalizedRuntimeRetryOptions,
  PluginAssetsRetryOptions,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type { PluginAssetsRetryOptions };

export const PLUGIN_ASSETS_RETRY_NAME = 'rsbuild:assets-retry';

function getRuntimeOptions(
  userOptions: PluginAssetsRetryOptions,
): NormalizedRuntimeRetryOptions {
  const { inlineScript, minify, ...restOptions } = userOptions;
  const defaultOptions: NormalizedRuntimeRetryOptions = {
    max: 3,
    type: ['link', 'script', 'img'],
    domain: [],
    crossOrigin: false,
    delay: 0,
    addQuery: false,
  };

  const result: NormalizedRuntimeRetryOptions = {
    ...defaultOptions,
    ...restOptions,
  };

  // Normalize config
  if (!Array.isArray(result.type) || result.type.length === 0) {
    result.type = defaultOptions.type;
  }
  if (!Array.isArray(result.domain) || result.domain.length === 0) {
    result.domain = defaultOptions.domain;
  }
  if (Array.isArray(result.domain)) {
    result.domain = result.domain.filter(Boolean);
  }

  return result;
}

async function getRetryCode(
  options: NormalizedRuntimeRetryOptions,
  minify: boolean,
): Promise<string> {
  const filename = 'initialChunkRetry';
  const runtimeFilePath = path.join(
    __dirname,
    'runtime',
    minify ? `${filename}.min.js` : `${filename}.js`,
  );
  const runtimeCode = await fs.promises.readFile(runtimeFilePath, 'utf-8');
  const runtimeOptions = getRuntimeOptions(options);

  return `(function(){${runtimeCode}})()`.replace(
    '__RETRY_OPTIONS__',
    serialize(runtimeOptions),
  );
}

export const pluginAssetsRetry = (
  userOptions: PluginAssetsRetryOptions = {},
): RsbuildPlugin => ({
  name: PLUGIN_ASSETS_RETRY_NAME,
  setup(api) {
    const { inlineScript = true } = userOptions;

    const getScriptPath = (environment: EnvironmentContext) => {
      const distDir = environment.config.output.distPath.js;
      return path.posix.join(distDir, `assets-retry.${PLUGIN_VERSION}.js`);
    };

    const normalizeOptions = (
      config: NormalizedEnvironmentConfig,
    ): PluginAssetsRetryOptions & {
      minify: boolean;
      crossorigin: boolean | 'anonymous' | 'use-credentials';
    } => {
      const options = { ...userOptions };

      // options.crossOrigin should be same as html.crossorigin by default
      if (options.crossOrigin === undefined) {
        options.crossOrigin = config.html.crossorigin;
      }

      if (options.minify === undefined) {
        const minify =
          typeof config.output.minify === 'boolean'
            ? config.output.minify
            : config.output.minify?.js;
        options.minify = minify && config.mode === 'production';
      }

      return options as PluginAssetsRetryOptions & {
        minify: boolean;
        crossorigin: boolean | 'anonymous' | 'use-credentials';
      };
    };

    if (inlineScript) {
      api.modifyHTMLTags(async ({ headTags, bodyTags }, { environment }) => {
        const options = normalizeOptions(environment.config);
        const runtimeOptions = getRuntimeOptions(options);
        const code = await getRetryCode(runtimeOptions, options.minify);

        headTags.unshift({
          tag: 'script',
          attrs: {},
          children: code,
        });

        return { headTags, bodyTags };
      });
    } else {
      api.modifyHTMLTags(
        async ({ headTags, bodyTags }, { assetPrefix, environment }) => {
          const scriptPath = getScriptPath(environment);
          const url = ensureAssetPrefix(scriptPath, assetPrefix);

          headTags.unshift({
            tag: 'script',
            attrs: {
              src: url,
            },
          });

          return { headTags, bodyTags };
        },
      );

      api.processAssets(
        { stage: 'additional' },
        async ({ sources, compilation, environment }) => {
          const scriptPath = getScriptPath(environment);
          const options = normalizeOptions(environment.config);
          const runtimeOptions = getRuntimeOptions(options);
          const code = await getRetryCode(runtimeOptions, options.minify);
          compilation.emitAsset(scriptPath, new sources.RawSource(code));
        },
      );
    }

    api.modifyBundlerChain(async (chain, { environment }) => {
      const { config, htmlPaths } = environment;

      if (!userOptions || Object.keys(htmlPaths).length === 0) {
        return;
      }

      const options = normalizeOptions(config);
      const runtimeOptions = getRuntimeOptions(options);
      const isRspack = api.context.bundlerType === 'rspack';

      chain
        .plugin('async-chunk-retry')
        .use(AsyncChunkRetryPlugin, [runtimeOptions, isRspack, options.minify]);
    });
  },
});
