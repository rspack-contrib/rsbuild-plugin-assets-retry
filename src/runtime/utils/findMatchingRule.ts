import { findCurrentDomain } from './urlCalculate.js';

/**
 * match rule by
 * 1. `test`
 * 2. `domain`
 * 3. `type` (not included in this function)
 */
export function findMatchingRule(
  url: string,
  rules: NormalizedRuntimeRetryOptions[],
): NormalizedRuntimeRetryOptions | null {
  for (const rule of rules) {
    // Check test condition
    const tester = rule.test;
    let shouldMatch = true;
    if (tester instanceof RegExp) {
      shouldMatch = tester.test(url);
    } else if (typeof tester === 'string') {
      const regexp = new RegExp(tester);
      shouldMatch = regexp.test(url);
    } else if (typeof tester === 'function') {
      shouldMatch = tester(url);
    }

    if (!shouldMatch) {
      continue;
    }

    // Check domain condition
    if (rule.domain && rule.domain.length > 0) {
      const domain = findCurrentDomain(url, rule);
      if (!rule.domain.includes(domain)) {
        continue;
      }
    }

    return rule;
  }

  return null;
}
