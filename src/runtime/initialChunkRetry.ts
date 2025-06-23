// rsbuild/runtime/initial-chunk-retry
import {
  findCurrentDomain,
  findNextDomain,
  getNextRetryUrl,
  getQueryFromUrl,
} from './urlCalculate.js';

interface ScriptElementAttributes {
  url: string;
  times: number;
  isAsync: boolean;
  originalQuery: string;
  crossOrigin?: CrossOrigin | boolean;
}

const TAG_TYPE: { [propName: string]: new () => HTMLElement } = {
  link: HTMLLinkElement,
  script: HTMLScriptElement,
  img: HTMLImageElement,
};

declare global {
  // global variables shared with async chunk
  var __RB_ASYNC_CHUNKS__: Record<string, boolean>;
  var __RETRY_OPTIONS__: NormalizedRuntimeRetryOptions;
}

function getRequestUrl(element: HTMLElement) {
  if (
    element instanceof HTMLScriptElement ||
    element instanceof HTMLImageElement
  ) {
    // For <script src="" /> or <img src="" />
    // element.getAttribute('src') === '' but element.src === baseURI
    if (!element.getAttribute('src')?.trim()) {
      return null;
    }
    return element.src;
  }
  if (element instanceof HTMLLinkElement) {
    // For <link href="" />
    if (!element.getAttribute('href')?.trim()) {
      return null;
    }
    return element.href;
  }
  return null;
}

function validateTargetInfo(
  config: NormalizedRuntimeRetryOptions,
  e: Event,
): { target: HTMLElement; tagName: string; url: string } | false {
  const target: HTMLElement = e.target as HTMLElement;
  const tagName = target.tagName.toLocaleLowerCase();
  const allowTags = config.type;
  const url = getRequestUrl(target);
  if (
    !tagName ||
    allowTags.indexOf(tagName) === -1 ||
    !TAG_TYPE[tagName] ||
    !(target instanceof TAG_TYPE[tagName]) ||
    !url
  ) {
    return false;
  }

  return { target, tagName, url };
}

function createElement(
  origin: HTMLElement,
  attributes: ScriptElementAttributes,
): { element: HTMLElement; str: string } | undefined {
  const crossOrigin =
    attributes.crossOrigin === true ? 'anonymous' : attributes.crossOrigin;
  const crossOriginAttr = crossOrigin ? `crossorigin="${crossOrigin}"` : '';
  const retryTimesAttr = attributes.times
    ? `data-rb-retry-times="${attributes.times}"`
    : '';

  const originalQueryAttr = attributes.originalQuery
    ? `data-rb-original-query="${attributes.originalQuery}"`
    : '';
  const isAsyncAttr = attributes.isAsync ? 'data-rb-async' : '';

  if (origin instanceof HTMLScriptElement) {
    const script = document.createElement('script');
    script.src = attributes.url;
    if (crossOrigin) {
      script.crossOrigin = crossOrigin;
    }
    if (attributes.times) {
      script.dataset.rbRetryTimes = String(attributes.times);
    }
    if (attributes.isAsync) {
      script.dataset.rbAsync = '';
    }
    if (attributes.originalQuery !== undefined) {
      script.dataset.rbOriginalQuery = attributes.originalQuery;
    }

    return {
      element: script,
      str:
        // biome-ignore lint/style/useTemplate: use "</" + "script>" instead of script tag to avoid syntax error when inlining in html
        `<script src="${attributes.url}" ${crossOriginAttr} ${retryTimesAttr} ${isAsyncAttr} ${originalQueryAttr}>` +
        '</' +
        'script>',
    };
  }
  if (origin instanceof HTMLLinkElement) {
    const link = document.createElement('link');
    link.rel = origin.rel || 'stylesheet';

    if (origin.as) {
      link.as = origin.as;
    }

    link.href = attributes.url;
    if (crossOrigin) {
      link.crossOrigin = crossOrigin;
    }
    if (attributes.times) {
      link.dataset.rbRetryTimes = String(attributes.times);
    }
    if (attributes.originalQuery !== undefined) {
      link.dataset.rbOriginalQuery = attributes.originalQuery;
    }
    return {
      element: link,
      str: `<link rel="${link.rel}" href="${
        attributes.url
      }" ${crossOriginAttr} ${retryTimesAttr} ${
        link.as ? `as="${link.as}"` : ''
      } ${originalQueryAttr}></link>`,
    };
  }
}

function reloadElementResource(
  origin: HTMLElement,
  fresh: { element: HTMLElement; str: string },
  attributes: ScriptElementAttributes,
) {
  if (origin instanceof HTMLScriptElement) {
    if (attributes.isAsync) {
      document.body.appendChild(fresh.element);
    } else {
      document.write(fresh.str);
    }
  }

  if (origin instanceof HTMLLinkElement) {
    document.getElementsByTagName('head')[0].appendChild(fresh.element);
  }

  if (origin instanceof HTMLImageElement) {
    origin.src = attributes.url;
    origin.dataset.rbRetryTimes = String(attributes.times);
    origin.dataset.rbOriginalQuery = String(attributes.originalQuery);
  }
}

function retry(config: NormalizedRuntimeRetryOptions, e: Event) {
  const targetInfo = validateTargetInfo(config, e);
  if (targetInfo === false) {
    return;
  }

  const { target, tagName, url } = targetInfo;

  // If the requested failed chunk is async chunk，skip it, because async chunk will be retried by asyncChunkRetry runtime
  if (
    typeof window !== 'undefined' &&
    Object.keys(window.__RB_ASYNC_CHUNKS__ || {}).some((chunkName) => {
      return url.indexOf(chunkName) !== -1;
    })
  ) {
    return;
  }

  // Filter by config.test and config.domain
  let tester = config.test;
  if (tester) {
    if (typeof tester === 'string') {
      const regexp = new RegExp(tester);
      tester = (str: string) => regexp.test(str);
    }

    if (typeof tester !== 'function' || !tester(url)) {
      return;
    }
  }

  const domain = findCurrentDomain(url, config);

  if (
    config.domain &&
    config.domain.length > 0 &&
    config.domain.indexOf(domain) === -1
  ) {
    return;
  }

  // If the retry times has exceeded the maximum, fail
  const existRetryTimes = Number(target.dataset.rbRetryTimes) || 0;
  if (existRetryTimes === config.max!) {
    if (typeof config.onFail === 'function') {
      const context: AssetsRetryHookContext = {
        times: existRetryTimes,
        domain,
        url,
        tagName,
        isAsyncChunk: false,
      };
      config.onFail(context);
    }
    return;
  }

  // Then, we will start to retry
  const nextDomain = findNextDomain(domain, config);

  // if the initial request is "/static/js/async/src_Hello_tsx.js?q=1", retry url would be "/static/js/async/src_Hello_tsx.js?q=1&retry=1"
  const originalQuery = target.dataset.rbOriginalQuery ?? getQueryFromUrl(url);

  const isAsync =
    Boolean(target.dataset.rbAsync) ||
    (target as HTMLScriptElement).async ||
    (target as HTMLScriptElement).defer;

  const attributes: ScriptElementAttributes = {
    url: getNextRetryUrl(
      url,
      domain,
      nextDomain,
      existRetryTimes,
      originalQuery,
      config,
    ),
    times: existRetryTimes + 1,
    crossOrigin: config.crossOrigin,
    isAsync,
    originalQuery,
  };

  const element = createElement(target, attributes)!;

  const context: AssetsRetryHookContext = {
    times: existRetryTimes,
    domain,
    url,
    tagName,
    isAsyncChunk: false,
  };

  if (typeof config.onRetry === 'function') {
    config.onRetry(context);
  }

  // Delay retry
  const delayValue =
    typeof config.delay === 'function' ? config.delay(context) : config.delay;

  if (delayValue > 0) {
    setTimeout(() => {
      reloadElementResource(target, element, attributes);
    }, delayValue);
  } else {
    reloadElementResource(target, element, attributes);
  }
}

function load(config: NormalizedRuntimeRetryOptions, e: Event) {
  const targetInfo = validateTargetInfo(config, e);
  if (targetInfo === false) {
    return;
  }
  const { target, tagName, url } = targetInfo;
  const domain = findCurrentDomain(url, config);
  const retryTimes = Number(target.dataset.rbRetryTimes) || 0;
  if (retryTimes === 0) {
    return;
  }
  if (typeof config.onSuccess === 'function') {
    const context: AssetsRetryHookContext = {
      times: retryTimes,
      domain,
      url,
      tagName,
      isAsyncChunk: false,
    };
    config.onSuccess(context);
  }
}

function registerInitialChunkRetry() {
  // init global variables shared with async chunk
  if (typeof window !== 'undefined' && !window.__RB_ASYNC_CHUNKS__) {
    window.__RB_ASYNC_CHUNKS__ = {};
  }
  try {
    const config = __RETRY_OPTIONS__;
    // Bind event in window
    if (
      typeof window !== 'undefined' &&
      typeof window.document !== 'undefined'
    ) {
      document.addEventListener(
        'error',
        (e) => {
          if (e && e.target instanceof Element) {
            try {
              retry(config, e);
            } catch (err) {
              console.error('retry error captured', err);
            }
          }
        },
        true,
      );
      document.addEventListener(
        'load',
        (e) => {
          if (e && e.target instanceof Element) {
            try {
              load(config, e);
            } catch (err) {
              console.error('load error captured', err);
            }
          }
        },
        true,
      );
    }
  } catch (err) {
    console.error('monitor error captured', err);
  }
}

registerInitialChunkRetry();
