import { stripVTControlCharacters as stripAnsi } from 'node:util';
import type { Page } from '@playwright/test';
import { type RequestHandler, createRsbuild } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';
import { type PluginAssetsRetryOptions, pluginAssetsRetry } from '../../dist';

const portMap = new Map();

export function getRandomPort(
  defaultPort = Math.ceil(Math.random() * 30000) + 15000,
) {
  let port = defaultPort;
  while (true) {
    if (!portMap.get(port)) {
      portMap.set(port, 1);
      return port;
    }
    port++;
  }
}

export const getHrefByEntryName = (entryName: string, port: number) => {
  const htmlRoot = new URL(`http://localhost:${port}`);
  const homeUrl = new URL(`${entryName}.html`, htmlRoot);

  return homeUrl.href;
};

export const gotoPage = async (
  page: Page,
  rsbuild: { port: number },
  path = 'index',
) => {
  const url = getHrefByEntryName(path, rsbuild.port);
  return page.goto(url);
};

export function count404Response(logs: string[], urlPrefix: string): number {
  let count = 0;
  for (const log of logs) {
    const rawLog = stripAnsi(log);
    // e.g: 18:09:23 404 GET /static/js/index.js 4.443 ms
    if (rawLog.includes('404 GET') && rawLog.includes(urlPrefix)) {
      count++;
    }
  }
  return count;
}

export function count404ResponseByUrl(
  logs: string[],
  urlPrefix: string,
): Record<string, number> {
  const countCollector: Record<string, number> = {};
  // e.g: 18:09:23 404 GET /static/js/index.js 4.443 ms
  const reg = /404\sGET\s(.*)\s\d/;
  for (const log of logs) {
    const rawLog = stripAnsi(log);
    const url = reg.exec(rawLog)?.[1];
    if (!url) {
      continue;
    }
    if (!url.startsWith(urlPrefix)) {
      continue;
    }
    if (!countCollector[url]) {
      countCollector[url] = 0;
    }
    countCollector[url] += 1;
  }
  return countCollector;
}

export type AssetsRetryHookContext = {
  url: string;
  times: number;
  domain: string;
  tagName: string;
};

interface BlockMiddlewareOptions {
  urlPrefix: string;
  blockNum: number;
  onBlock?: (context: {
    url: string;
    count: number;
    timestamp: number;
  }) => void;
}

export function createBlockMiddleware({
  urlPrefix,
  blockNum,
  onBlock,
}: BlockMiddlewareOptions): RequestHandler {
  let counter = 0;

  return (req, res, next) => {
    if (req.url?.startsWith(urlPrefix)) {
      counter++;
      // if blockNum is 3, 1 2 3 would be blocked, 4 would be passed
      const isBlocked = counter <= blockNum;

      if (isBlocked && onBlock) {
        onBlock({
          url: req.url,
          count: counter,
          timestamp: Date.now(),
        });
      }
      if (isBlocked) {
        res.statusCode = 404;
      }
      res.setHeader('block-async', counter);
    }
    next();
  };
}

export async function createRsbuildWithMiddleware(
  middleware: RequestHandler | RequestHandler[],
  options: PluginAssetsRetryOptions | PluginAssetsRetryOptions[],
  entry?: string,
  port?: number,
  assetPrefix?: string,
) {
  const rsbuild = await createRsbuild({
    cwd: import.meta.dirname,
    rsbuildConfig: {
      plugins: [pluginReact(), pluginAssetsRetry(options)],
      dev: {
        hmr: false,
        liveReload: false,
        setupMiddlewares: [
          (middlewares, _server) => {
            const addMiddleWares = Array.isArray(middleware)
              ? middleware
              : [middleware];
            middlewares.unshift(...addMiddleWares);
          },
        ],
        ...(assetPrefix
          ? {
              assetPrefix,
            }
          : {}),
      },
      ...(port
        ? {
            server: {
              port,
            },
          }
        : {
            server: {
              port: getRandomPort(),
            },
          }),
      ...(entry
        ? {
            source: { entry: { index: entry } },
          }
        : {}),
      output: {
        sourceMap: false,
      },
    },
  });

  return rsbuild.startDevServer();
}

export function delay(ms = 300) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(1);
    }, ms);
  });
}

export async function proxyPageConsole(page: Page, port: number) {
  const onRetryContextList: AssetsRetryHookContext[] = [];
  const onSuccessContextList: AssetsRetryHookContext[] = [];
  const onFailContextList: AssetsRetryHookContext[] = [];

  const origin = `http://localhost:${port}`;

  page.on('console', async (msg) => {
    if (msg.type() !== 'info') {
      return;
    }
    const typeValue = (await msg.args()[0].jsonValue()) as string;
    const contextValue = (await msg
      .args()[1]
      .jsonValue()) as AssetsRetryHookContext;

    if (
      typeValue === 'onRetry' ||
      typeValue === 'onSuccess' ||
      typeValue === 'onFail'
    ) {
      // For snapshot
      contextValue.url = contextValue.url?.replace(origin, '<ORIGIN>');
      contextValue.domain = contextValue.domain?.replace(origin, '<ORIGIN>');
    }

    if (typeValue === 'onRetry') {
      onRetryContextList.push(contextValue);
    } else if (typeValue === 'onSuccess') {
      onSuccessContextList.push(contextValue);
    } else if (typeValue === 'onFail') {
      onFailContextList.push(contextValue);
    }
  });
  return {
    onRetryContextList,
    onSuccessContextList,
    onFailContextList,
  };
}

export const proxyConsole = (
  types: string | string[] = ['log', 'warn', 'info', 'error'],
  keepAnsi = false,
) => {
  const logs: string[] = [];
  const restores: Array<() => void> = [];

  for (const type of Array.isArray(types) ? types : [types]) {
    const method = console[type];

    restores.push(() => {
      console[type] = method;
    });

    console[type] = (log) => {
      logs.push(keepAnsi ? log : stripAnsi(log));
    };
  }

  return {
    logs,
    restore: () => {
      for (const restore of restores) {
        restore();
      }
    },
  };
};
