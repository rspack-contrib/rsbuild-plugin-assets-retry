import { ERROR_PREFIX } from './constants.js';
import { findMatchingRule } from './utils/findMatchingRule.js';
import {
  findCurrentDomain,
  findNextDomain,
  getNextRetryUrl,
  getQueryFromUrl,
} from './utils/urlCalculate.js';

// rsbuild/runtime/async-chunk-retry
type ChunkId = string; // e.g: src_AsyncCompTest_tsx
type ChunkFilename = string; // e.g: static/js/async/src_AsyncCompTest_tsx.js
type ChunkSrcUrl = string; // publicPath + ChunkFilename e.g: http://localhost:3000/static/js/async/src_AsyncCompTest_tsx.js

type Retry = {
  nextDomain: string;
  nextRetryUrl: ChunkSrcUrl;

  originalScriptFilename: ChunkFilename;
  originalSrcUrl: ChunkSrcUrl;
  originalQuery: string;
  rule: NormalizedRuntimeRetryOptions;
};

type RetryCollector = Record<ChunkId, Record<number, Retry>>;
type EnsureChunk = (chunkId: ChunkId, ...args: unknown[]) => Promise<unknown>;
type LoadScript = (
  url: ChunkSrcUrl,
  done: unknown,
  key: string,
  chunkId: ChunkId,
  ...args: unknown[]
) => string;
type LoadStyleSheet = (href: string, chunkId: ChunkId) => string;

declare global {
  // RuntimeGlobals.require
  var __RUNTIME_GLOBALS_REQUIRE__: unknown;
  // RuntimeGlobals.ensure
  var __RUNTIME_GLOBALS_ENSURE_CHUNK__: EnsureChunk;
  // RuntimeGlobals.getChunkScriptFilename
  var __RUNTIME_GLOBALS_GET_CHUNK_SCRIPT_FILENAME__: (
    chunkId: ChunkId,
    ...args: unknown[]
  ) => string;
  // RuntimeGlobals.getChunkCssFilename
  var __RUNTIME_GLOBALS_GET_CSS_FILENAME__:
    | ((chunkId: ChunkId, ...args: unknown[]) => string)
    | undefined;
  // RuntimeGlobals.getChunkCssFilename when using Rspack.CssExtractPlugin
  var __RUNTIME_GLOBALS_GET_MINI_CSS_EXTRACT_FILENAME__:
    | ((chunkId: ChunkId, ...args: unknown[]) => string)
    | undefined;
  // RuntimeGlobals.loadScript
  var __RUNTIME_GLOBALS_LOAD_SCRIPT__: LoadScript;
  // __webpack_require__.rbLoadStyleSheet
  var __RUNTIME_GLOBALS_RSBUILD_LOAD_STYLESHEET__: LoadStyleSheet;
  // RuntimeGlobals.publicPath
  var __RUNTIME_GLOBALS_PUBLIC_PATH__: string;
}

// init retryCollector and nextRetry function
const rules = __RETRY_OPTIONS__;
const retryCollector: RetryCollector = {};
const retryCssCollector: RetryCollector = {};

// shared between ensureChunk and loadScript
const globalCurrRetrying: Record<ChunkId, Retry | undefined> = {};
// shared between ensureChunk and loadStyleSheet
const globalCurrRetryingCss: Record<ChunkId, Retry | undefined> = {};

function getCurrentRetry(
  chunkId: string,
  existRetryTimes: number,
  isCssAsyncChunk: boolean,
): Retry | undefined {
  return isCssAsyncChunk
    ? retryCssCollector[chunkId]?.[existRetryTimes]
    : retryCollector[chunkId]?.[existRetryTimes];
}

function initRetry(chunkId: string, isCssAsyncChunk: boolean): Retry | null {
  const originalScriptFilename = isCssAsyncChunk
    ? originalGetCssFilename(chunkId)
    : originalGetChunkScriptFilename(chunkId);

  if (!originalScriptFilename) {
    throw new Error('only support cssExtract');
  }

  const originalPublicPath = __RUNTIME_GLOBALS_PUBLIC_PATH__;
  const originalSrcUrl =
    originalPublicPath[0] === '/' && originalPublicPath[1] !== '/'
      ? window.origin + originalPublicPath + originalScriptFilename
      : originalPublicPath + originalScriptFilename;
  const originalQuery = getQueryFromUrl(originalSrcUrl);

  const existRetryTimes = 0;
  const rule = findMatchingRule(originalSrcUrl, rules);
  if (
    rule === null ||
    rule.type.indexOf(isCssAsyncChunk ? 'link' : 'script') === -1
  ) {
    return null;
  }
  const nextDomain = findCurrentDomain(originalSrcUrl, rule);

  return {
    nextDomain,
    nextRetryUrl: getNextRetryUrl(
      originalSrcUrl,
      nextDomain,
      nextDomain,
      existRetryTimes,
      originalQuery,
      rule,
    ),
    originalScriptFilename,
    originalSrcUrl,
    originalQuery,
    rule,
  };
}

function nextRetry(
  chunkId: string,
  existRetryTimes: number,
  isCssAsyncChunk: boolean,
): Retry | null {
  const currRetry = getCurrentRetry(chunkId, existRetryTimes, isCssAsyncChunk);

  let nextRetry: Retry | null;
  const nextExistRetryTimes = existRetryTimes + 1;

  if (existRetryTimes === 0 || currRetry === undefined) {
    nextRetry = initRetry(chunkId, isCssAsyncChunk);
    if (!nextRetry) {
      return null;
    }
    if (isCssAsyncChunk) {
      retryCssCollector[chunkId] = [];
    } else {
      retryCollector[chunkId] = [];
    }
  } else {
    const { originalScriptFilename, originalSrcUrl, originalQuery, rule } =
      currRetry;
    const nextDomain = findNextDomain(currRetry.nextDomain, rule);

    nextRetry = {
      nextDomain,
      nextRetryUrl: getNextRetryUrl(
        currRetry.nextRetryUrl,
        currRetry.nextDomain,
        nextDomain,
        existRetryTimes,
        originalQuery,
        rule,
      ),

      originalScriptFilename,
      originalSrcUrl,
      originalQuery,
      rule,
    };
  }

  if (isCssAsyncChunk) {
    retryCssCollector[chunkId][nextExistRetryTimes] = nextRetry;
    globalCurrRetryingCss[chunkId] = nextRetry;
  } else {
    retryCollector[chunkId][nextExistRetryTimes] = nextRetry;
    globalCurrRetrying[chunkId] = nextRetry;
  }
  return nextRetry;
}

// rewrite webpack runtime with nextRetry()
const originalEnsureChunk = __RUNTIME_GLOBALS_ENSURE_CHUNK__;
const originalGetChunkScriptFilename =
  __RUNTIME_GLOBALS_GET_CHUNK_SCRIPT_FILENAME__;
const originalGetCssFilename =
  __RUNTIME_GLOBALS_GET_MINI_CSS_EXTRACT_FILENAME__ ||
  __RUNTIME_GLOBALS_GET_CSS_FILENAME__ ||
  (() => null);
const originalLoadScript = __RUNTIME_GLOBALS_LOAD_SCRIPT__;

// if users want to support es5, add Promise polyfill first https://github.com/webpack/webpack/issues/12877
function ensureChunk(chunkId: string): Promise<unknown> {
  // biome-ignore lint/style/noArguments: allowed
  const args = Array.prototype.slice.call(arguments);

  // Other webpack runtimes would add arguments for `__webpack_require__.e`,
  // So we use `arguments[10]` to avoid conflicts with other runtimes
  if (!args[10]) {
    args[10] = { count: 0, cssFailedCount: 0 };
  }
  const callingCounter: { count: number; cssFailedCount: number } = args[10];

  const result = originalEnsureChunk.apply(
    null,
    args as Parameters<EnsureChunk>,
  );

  try {
    const originalScriptFilename = originalGetChunkScriptFilename(chunkId);
    const originalCssFilename = originalGetCssFilename(chunkId);

    // mark the async chunk name in the global variables and share it with initial chunk retry to avoid duplicate retrying
    if (typeof window !== 'undefined') {
      if (originalScriptFilename) {
        window.__RB_ASYNC_CHUNKS__[originalScriptFilename] = true;
      }
      if (originalCssFilename) {
        window.__RB_ASYNC_CHUNKS__[originalCssFilename] = true;
      }
    }
  } catch (e) {
    console.error(ERROR_PREFIX, 'get original script or CSS filename error', e);
  }

  // if __webpack_require__.e is polluted by other runtime codes, fallback to originalEnsureChunk
  if (
    !callingCounter ||
    typeof callingCounter.count !== 'number' ||
    typeof callingCounter.cssFailedCount !== 'number'
  ) {
    return result;
  }

  callingCounter.count += 1;

  return result.catch((error: Error) => {
    // the first calling is not retry
    // if the failed request is 4 in network panel, callingCounter.count === 4, the first one is the normal request, and existRetryTimes is 3, retried 3 times
    const existRetryTimesAll = callingCounter.count - 1;
    const cssExistRetryTimes = callingCounter.cssFailedCount;
    const jsExistRetryTimes = existRetryTimesAll - cssExistRetryTimes;
    let originalScriptFilename: string;
    let nextRetryUrl: string;
    let nextDomain: string;
    let rule: NormalizedRuntimeRetryOptions;

    const isCssAsyncChunkLoadFailed = Boolean(
      error?.message?.includes('CSS chunk'),
    );
    if (isCssAsyncChunkLoadFailed) {
      callingCounter.cssFailedCount += 1;
    }

    const existRetryTimes = isCssAsyncChunkLoadFailed
      ? cssExistRetryTimes
      : jsExistRetryTimes;

    try {
      const retryResult = nextRetry(
        chunkId,
        existRetryTimes,
        isCssAsyncChunkLoadFailed,
      );
      if (!retryResult) {
        throw error;
      }
      originalScriptFilename = retryResult.originalScriptFilename;
      nextRetryUrl = retryResult.nextRetryUrl;
      nextDomain = retryResult.nextDomain;
      rule = retryResult.rule;
    } catch (e) {
      if (e !== error) {
        console.error(ERROR_PREFIX, 'failed to get nextRetryUrl', e);
      }
      throw error;
    }

    const createContext = (times: number): AssetsRetryHookContext => ({
      times,
      domain: nextDomain,
      url: nextRetryUrl,
      tagName: isCssAsyncChunkLoadFailed ? 'link' : 'script',
      isAsyncChunk: true,
    });

    const context = createContext(existRetryTimes);

    if (existRetryTimes >= rule.max) {
      error.message = error.message?.includes('retries:')
        ? error.message
        : `Loading chunk ${chunkId} from "${originalScriptFilename}" failed after ${rule.max} retries: "${error.message}"`;
      if (typeof rule.onFail === 'function') {
        rule.onFail(context);
      }
      throw error;
    }

    // Start retry
    if (typeof rule.onRetry === 'function') {
      rule.onRetry(context);
    }

    const delayTime =
      typeof rule.delay === 'function' ? rule.delay(context) : rule.delay;

    const delayPromise =
      delayTime > 0
        ? new Promise((resolve) => setTimeout(resolve, delayTime))
        : Promise.resolve();

    return delayPromise
      .then(() => ensureChunk.apply(ensureChunk, args as [string]))
      .then((result) => {
        // when after retrying the third time
        // ensureChunk(chunkId, { count: 3 }), at that time, existRetryTimes === 2
        // at the end, callingCounter.count is 4
        const isLastSuccessRetry =
          callingCounter?.count === existRetryTimesAll + 2;
        if (typeof rule.onSuccess === 'function' && isLastSuccessRetry) {
          const context = createContext(existRetryTimes + 1);
          rule.onSuccess(context);
        }
        return result;
      });
  });
}

function loadScript(): string {
  // biome-ignore lint/style/noArguments: allowed
  const args = Array.prototype.slice.call(arguments) as Parameters<LoadScript>;
  const retry = globalCurrRetrying[args[3]];
  if (retry) {
    args[0] = retry.nextRetryUrl;
  }
  return originalLoadScript.apply(null, args);
}

function loadStyleSheet(href: string, chunkId: ChunkId): string {
  const retry = globalCurrRetryingCss[chunkId];
  return (
    // biome-ignore lint/complexity/useOptionalChain: for less code
    (retry && retry.nextRetryUrl) || __RUNTIME_GLOBALS_PUBLIC_PATH__ + href
  );
}

function registerAsyncChunkRetry() {
  // init global variables shared between initial-chunk-retry and async-chunk-retry
  if (typeof window !== 'undefined' && !window.__RB_ASYNC_CHUNKS__) {
    window.__RB_ASYNC_CHUNKS__ = {};
  }

  if (typeof __RUNTIME_GLOBALS_REQUIRE__ !== 'undefined') {
    try {
      __RUNTIME_GLOBALS_ENSURE_CHUNK__ = ensureChunk as (
        chunkId: string,
        ...args: unknown[]
      ) => Promise<unknown>;
      __RUNTIME_GLOBALS_LOAD_SCRIPT__ = loadScript;
      __RUNTIME_GLOBALS_RSBUILD_LOAD_STYLESHEET__ = loadStyleSheet;
    } catch (e) {
      console.error(
        ERROR_PREFIX,
        'Register async chunk retry runtime failed',
        e,
      );
    }
  }
}

registerAsyncChunkRetry();
