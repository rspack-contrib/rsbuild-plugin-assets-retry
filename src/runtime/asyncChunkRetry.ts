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
  rule: RuntimeRetryOptions;
};

type RetryCollector = Record<ChunkId, Record<number, Retry>>;
type EnsureChunk = (chunkId: ChunkId, ...args: unknown[]) => Promise<unknown>;
type LoadScript = (
  url: ChunkSrcUrl,
  done: unknown,
  key: string,
  chunkId: ChunkId,
  ...args: unknown[]
) => void;
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
  // user options
  var __RETRY_OPTIONS__: RuntimeRetryRules;
  // global variables shared with initial chunk retry runtime
  var __RB_ASYNC_CHUNKS__: Record<ChunkFilename, boolean>;
}

// init retryCollector and nextRetry function
const rules = __RETRY_OPTIONS__;
const retryCollector: RetryCollector = {};
const retryCssCollector: RetryCollector = {};

function findCurrentDomain(url: string, domains: string[]) {
  let domain = '';
  for (let i = 0; i < domains.length; i++) {
    if (url.indexOf(domains[i]) !== -1) {
      domain = domains[i];
      break;
    }
  }
  return domain || window.origin;
}

function findNextDomain(url: string, domains: string[]) {
  if (domains.length === 0) {
    return findCurrentDomain(url, domains);
  }
  const currentDomain = findCurrentDomain(url, domains);
  const index = domains.indexOf(currentDomain);
  return domains[(index + 1) % domains.length] || currentDomain;
}

const postfixRE = /[?#].*$/;
function cleanUrl(url: string) {
  return url.replace(postfixRE, '');
}
function getQueryFromUrl(url: string) {
  const parts = url.split('?')[1];
  return parts ? `?${parts.split('#')[0]}` : '';
}

function findMatchingRule(url: string): RuntimeRetryOptions | null {
  // If no rules provided, no retry
  if (!rules || rules.length === 0) {
    return null;
  }

  for (const rule of rules) {
    // Check test condition
    const tester = rule.test;
    if (tester) {
      if (typeof tester === 'string') {
        const regexp = new RegExp(tester);
        if (!regexp.test(url)) continue;
      } else if (typeof tester === 'function' && !tester(url)) {
        continue;
      }
    }

    // Check domain condition
    const domain = findCurrentDomain(url, rule.domain || []);
    if (
      rule.domain &&
      rule.domain.length > 0 &&
      rule.domain.indexOf(domain) === -1
    ) {
      continue;
    }

    return rule;
  }

  // Return null if no match
  return null;
}

function getUrlRetryQuery(
  existRetryTimes: number,
  originalQuery: string,
  rule: RuntimeRetryOptions,
): string {
  if (rule.addQuery === true) {
    return originalQuery !== ''
      ? `${originalQuery}&retry=${existRetryTimes}`
      : `?retry=${existRetryTimes}`;
  }
  if (typeof rule.addQuery === 'function') {
    return rule.addQuery({ times: existRetryTimes, originalQuery });
  }
  return '';
}

function getNextRetryUrl(
  currRetryUrl: string,
  domain: string,
  nextDomain: string,
  existRetryTimes: number,
  originalQuery: string,
  rule: RuntimeRetryOptions,
) {
  return (
    cleanUrl(currRetryUrl.replace(domain, nextDomain)) +
    getUrlRetryQuery(existRetryTimes + 1, originalQuery, rule)
  );
}

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

  const rule = findMatchingRule(originalSrcUrl);
  
  // If no rule matches, don't retry
  if (!rule) {
    return null;
  }

  const existRetryTimes = 0;
  const nextDomain = findCurrentDomain(originalSrcUrl, rule.domain || []);

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
    const nextDomain = findNextDomain(currRetry.nextDomain, rule.domain || []);

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

const ERROR_PREFIX = '[@rsbuild/plugin-assets-retry] ';

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
    let rule: RuntimeRetryOptions;

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
      
      // If no retry rule matches, throw the original error
      if (!retryResult) {
        throw error;
      }
      
      originalScriptFilename = retryResult.originalScriptFilename;
      nextRetryUrl = retryResult.nextRetryUrl;
      nextDomain = retryResult.nextDomain;
      rule = retryResult.rule;
    } catch (e) {
      console.error(ERROR_PREFIX, 'failed to get nextRetryUrl', e);
      throw error;
    }

    const maxRetries = rule.max || 3;

    const createContext = (times: number): AssetsRetryHookContext => ({
      times,
      domain: nextDomain,
      url: nextRetryUrl,
      tagName: isCssAsyncChunkLoadFailed ? 'link' : 'script',
      isAsyncChunk: true,
    });

    const context = createContext(existRetryTimes);

    if (existRetryTimes >= maxRetries) {
      error.message = error.message?.includes('retries:')
        ? error.message
        : `Loading chunk ${chunkId} from "${originalScriptFilename}" failed after ${maxRetries} retries: "${error.message}"`;
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
      typeof rule.delay === 'function'
        ? rule.delay(context)
        : (rule.delay ?? 0);

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

function loadScript() {
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
