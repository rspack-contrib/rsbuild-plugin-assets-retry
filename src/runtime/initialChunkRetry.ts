// rsbuild/runtime/initial-chunk-retry
import { ERROR_PREFIX } from './constants.js';
import { findMatchingRule } from './utils/findMatchingRule.js';
import {
  findCurrentDomain,
  findNextDomain,
  getNextRetryUrl,
  getQueryFromUrl,
} from './utils/urlCalculate.js';

interface ScriptElementAttributes {
  url: string;
  times: number;
  originalQuery: string;
  ruleIndex: number;

  crossOrigin?: CrossOrigin | boolean; // script only
  isAsync: boolean; // script only
}

const TAG_TYPE: { [propName: string]: new () => HTMLElement } = {
  link: HTMLLinkElement,
  script: HTMLScriptElement,
  img: HTMLImageElement,
};

function getRequestUrl(element: HTMLElement) {
  if (
    element instanceof HTMLScriptElement ||
    element instanceof HTMLImageElement
  ) {
    return element.src;
  }
  if (element instanceof HTMLLinkElement) {
    return element.href;
  }
  return null;
}

function validateTargetInfo(
  rules: NormalizedRuntimeRetryOptions[],
  e: Event,
):
  | {
      target: HTMLElement;
      tagName: string;
      url: string;
      rule: NormalizedRuntimeRetryOptions;
    }
  | false {
  const target: HTMLElement = e.target as HTMLElement;
  const tagName = target.tagName.toLocaleLowerCase();

  const url = getRequestUrl(target);
  if (!url) {
    return false;
  }

  const ruleIndex = Number(target.dataset.rbRuleI);
  const rule = rules[ruleIndex] ?? findMatchingRule(url, rules);
  if (!rule) {
    return false;
  }

  const allowTags = rule.type;
  if (
    !tagName ||
    allowTags.indexOf(tagName) === -1 ||
    !TAG_TYPE[tagName] ||
    !(target instanceof TAG_TYPE[tagName])
  ) {
    return false;
  }

  return { target, tagName, url, rule };
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

  const ruleIndexAttr =
    attributes.ruleIndex > 0 ? `data-rb-rule-i="${attributes.ruleIndex}"` : '';

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
    if (attributes.ruleIndex > 0) {
      script.dataset.rbRuleI = String(attributes.ruleIndex);
    }

    return {
      element: script,
      str:
        // biome-ignore lint/style/useTemplate: use "</" + "script>" instead of script tag to avoid syntax error when inlining in html
        `<script src="${attributes.url}" ${crossOriginAttr} ${retryTimesAttr} ${isAsyncAttr} ${ruleIndexAttr} ${originalQueryAttr}>` +
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
      } ${ruleIndexAttr} ${originalQueryAttr}></link>`,
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
      console.warn(
        ERROR_PREFIX,
        'load sync script failed, for security only async/defer script can be retried',
        origin,
      );
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

function retry(rules: NormalizedRuntimeRetryOptions[], e: Event) {
  const targetInfo = validateTargetInfo(rules, e);
  if (targetInfo === false) {
    return;
  }

  const { target, tagName, url, rule } = targetInfo;

  // If the requested failed chunk is async chunk，skip it, because async chunk will be retried by asyncChunkRetry runtime
  if (
    typeof window !== 'undefined' &&
    Object.keys(window.__RB_ASYNC_CHUNKS__ || {}).some((chunkName) => {
      return url.indexOf(chunkName) !== -1;
    })
  ) {
    return;
  }

  const domain = findCurrentDomain(url, rule);

  // If the retry times has exceeded the maximum, fail
  const existRetryTimes = Number(target.dataset.rbRetryTimes) || 0;
  if (existRetryTimes === rule.max) {
    if (typeof rule.onFail === 'function') {
      const context: AssetsRetryHookContext = {
        times: existRetryTimes,
        domain,
        url,
        tagName,
        isAsyncChunk: false,
      };
      rule.onFail(context);
    }
    return;
  }

  // Then, we will start to retry
  const nextDomain = findNextDomain(domain, rule);

  // if the initial request is "/static/js/async/src_Hello_tsx.js?q=1", retry url would be "/static/js/async/src_Hello_tsx.js?q=1&retry=1"
  const originalQuery = target.dataset.rbOriginalQuery ?? getQueryFromUrl(url);

  const ruleIndex = Number(target.dataset.rbRuleI) || 0;

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
      rule,
    ),
    times: existRetryTimes + 1,
    originalQuery,
    ruleIndex,
    crossOrigin: rule.crossOrigin,
    isAsync,
  };

  const element = createElement(target, attributes)!;

  const context: AssetsRetryHookContext = {
    times: existRetryTimes,
    domain,
    url,
    tagName,
    isAsyncChunk: false,
  };

  if (typeof rule.onRetry === 'function') {
    rule.onRetry(context);
  }

  // Delay retry
  const delayValue =
    typeof rule.delay === 'function' ? rule.delay(context) : rule.delay;

  if (delayValue > 0) {
    setTimeout(() => {
      reloadElementResource(target, element, attributes);
    }, delayValue);
  } else {
    reloadElementResource(target, element, attributes);
  }
}

function load(config: NormalizedRuntimeRetryOptions[], e: Event) {
  const targetInfo = validateTargetInfo(config, e);
  if (targetInfo === false) {
    return;
  }
  const { target, tagName, url, rule } = targetInfo;
  const domain = findCurrentDomain(url, rule);
  const retryTimes = Number(target.dataset.rbRetryTimes) || 0;
  if (retryTimes === 0) {
    return;
  }
  if (typeof rule.onSuccess === 'function') {
    const context: AssetsRetryHookContext = {
      times: retryTimes,
      domain,
      url,
      tagName,
      isAsyncChunk: false,
    };
    rule.onSuccess(context);
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
