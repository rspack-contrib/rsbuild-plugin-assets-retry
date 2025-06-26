export function findCurrentDomain(
  url: string,
  config: NormalizedRuntimeRetryOptions,
) {
  const domains = config.domain;
  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    if (url.indexOf(domain) !== -1) {
      return domain;
    }
  }
  return window.origin;
}

export function findNextDomain(
  url: string,
  config: NormalizedRuntimeRetryOptions,
) {
  const domains = config.domain;
  const currentDomain = findCurrentDomain(url, config);
  const index = domains.indexOf(currentDomain);
  return index === -1 ? currentDomain : domains[(index + 1) % domains.length];
}

const postfixRE = /[?#].*$/;
function cleanUrl(url: string) {
  return url.replace(postfixRE, '');
}
export function getQueryFromUrl(url: string) {
  const parts = url.split('?')[1];
  return parts ? `?${parts.split('#')[0]}` : '';
}

function getUrlRetryQuery(
  existRetryTimes: number,
  originalQuery: string,
  config: NormalizedRuntimeRetryOptions,
): string {
  if (config.addQuery === true) {
    return originalQuery !== ''
      ? `${originalQuery}&retry=${existRetryTimes}`
      : `?retry=${existRetryTimes}`;
  }
  if (typeof config.addQuery === 'function') {
    return config.addQuery({ times: existRetryTimes, originalQuery });
  }
  return '';
}

export function getNextRetryUrl(
  currRetryUrl: string,
  domain: string,
  nextDomain: string,
  existRetryTimes: number,
  originalQuery: string,
  config: NormalizedRuntimeRetryOptions,
) {
  return (
    cleanUrl(currRetryUrl.replace(domain, nextDomain)) +
    getUrlRetryQuery(existRetryTimes + 1, originalQuery, config)
  );
}
