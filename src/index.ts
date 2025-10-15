import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  EnvironmentContext,
  NormalizedEnvironmentConfig,
  RsbuildPlugin,
} from '@rsbuild/core';
import { ensureAssetPrefix, logger } from '@rsbuild/core';
import serialize from 'serialize-javascript';
import { AsyncChunkRetryPlugin } from './AsyncChunkRetryPlugin.js';
import type {
  NormalizedRuntimeRetryOptions,
  PluginAssetsRetryOptions,
  RuntimeRetryOptions,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type { PluginAssetsRetryOptions };

export const PLUGIN_ASSETS_RETRY_NAME = 'rsbuild:assets-retry';

// Unique identifier for filtering retry scripts in HTML templates
export const ASSETS_RETRY_DATA_ATTRIBUTE = 'data-rsbuild-assets-retry';

function getRuntimeOptions(
  userOptions: PluginAssetsRetryOptions,
  defaultCrossOrigin: boolean | 'anonymous' | 'use-credentials',
): NormalizedRuntimeRetryOptions[] {
  const { inlineScript, minify, ...runtimeOptions } = userOptions;
  const defaultOptions: NormalizedRuntimeRetryOptions = {
    max: 3,
    type: ['link', 'script', 'img'],
    domain: [],
    crossOrigin: defaultCrossOrigin,
    delay: 0,
    addQuery: false,
  };

  function normalizeOption(
    options: RuntimeRetryOptions,
  ): NormalizedRuntimeRetryOptions {
    const result: NormalizedRuntimeRetryOptions = {
      ...defaultOptions,
      ...options,
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
  if ('rules' in runtimeOptions) {
    const result = runtimeOptions.rules.map((i) => normalizeOption(i));
    return result;
  }

  return [normalizeOption(runtimeOptions)];
}

async function getRetryCode(
  runtimeOptions: NormalizedRuntimeRetryOptions[],
  minify: boolean,
): Promise<string> {
  const filename = 'initialChunkRetry';
  const runtimeFilePath = path.join(
    __dirname,
    'runtime',
    minify ? `${filename}.min.js` : `${filename}.js`,
  );
  const runtimeCode = await fs.promises.readFile(runtimeFilePath, 'utf-8');

  return runtimeCode.replace('__RETRY_OPTIONS__', serialize(runtimeOptions));
}

function logNoHtmlRegisterWaring() {
  logger.warn(
    `[${PLUGIN_ASSETS_RETRY_NAME}] no HTML files are generated in the current environment, so the "initialChunkRetry" script will not be injected. Please make sure to manually include the assets-retry script in your HTML files if needed.`,
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

    const getDefaultValueFromRsbuildConfig = (
      config: NormalizedEnvironmentConfig,
    ): {
      minify: boolean;
      crossorigin: boolean | 'anonymous' | 'use-credentials';
    } => {
      const minify =
        typeof config.output.minify === 'boolean'
          ? config.output.minify
          : config.output.minify?.js;

      return {
        crossorigin: config.html.crossorigin,
        minify: Boolean(minify) && config.mode === 'production',
      };
    };

    if (inlineScript) {
      api.modifyHTMLTags(async ({ headTags, bodyTags }, { environment }) => {
        const { htmlPaths, config } = environment;
        if (config.output.target === 'web' && Object.entries(htmlPaths).length === 0) {
          logNoHtmlRegisterWaring();
        }
        const { minify, crossorigin } = getDefaultValueFromRsbuildConfig(
          config,
        );
        const runtimeOptions = getRuntimeOptions(userOptions, crossorigin);
        const code = await getRetryCode(runtimeOptions, minify);

        headTags.unshift({
          tag: 'script',
          attrs: {
            [ASSETS_RETRY_DATA_ATTRIBUTE]: 'inline',
          },
          children: code,
        });

        return { headTags, bodyTags };
      });
    } else {
      api.modifyHTMLTags(
        async ({ headTags, bodyTags }, { assetPrefix, environment }) => {
          if( environment.config.output.target === 'web' && Object.entries(environment.htmlPaths).length === 0) {
            logNoHtmlRegisterWaring();
          }
          const scriptPath = getScriptPath(environment);
          const url = ensureAssetPrefix(scriptPath, assetPrefix);

          headTags.unshift({
            tag: 'script',
            attrs: {
              src: url,
              [ASSETS_RETRY_DATA_ATTRIBUTE]: 'external',
            },
          });

          return { headTags, bodyTags };
        },
      );

      api.processAssets(
        { stage: 'additional' },
        async ({ sources, compilation, environment }) => {
          const { config } = environment;
          if (config.output.target !== 'web') {
            return;
          }
          const scriptPath = getScriptPath(environment);
          const { crossorigin, minify } =
            getDefaultValueFromRsbuildConfig(config);
          const runtimeOptions = getRuntimeOptions(userOptions, crossorigin);
          const code = await getRetryCode(runtimeOptions, minify);
          compilation.emitAsset(scriptPath, new sources.RawSource(code));
        },
      );
    }

    api.modifyBundlerChain(async (chain, { environment }) => {
      const { config } = environment;
      if (config.output.target !== 'web') {
        return;
      }

      const { crossorigin, minify } = getDefaultValueFromRsbuildConfig(config);
      const runtimeOptions = getRuntimeOptions(userOptions, crossorigin);
      const isRspack = api.context.bundlerType === 'rspack';

      chain
        .plugin('async-chunk-retry')
        .use(AsyncChunkRetryPlugin, [runtimeOptions, isRspack, minify]);
    });
  },
});
