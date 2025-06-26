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
    let tester = rule.test;
    if (tester) {
      if (tester instanceof RegExp) {
        if (!tester.test(url)) continue;
      } else if (typeof tester === 'string') {
        const regexp = new RegExp(tester);
        tester = (str: string) => regexp.test(str);
      }
      if (typeof tester === 'function' && !tester(url)) {
        continue;
      }
    }

    // Check domain condition
    const domain = findCurrentDomain(url, rule);
    if (
      rule.domain &&
      rule.domain.length > 0 &&
      rule.domain.indexOf(domain) === -1
    ) {
      continue;
    }

    return rule;
  }

  return null;
}
