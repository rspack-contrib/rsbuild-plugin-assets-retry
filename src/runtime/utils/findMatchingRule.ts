import { findCurrentDomain } from './urlCalculate.js';

/**
 * match rule by
 * 1. `test`
 * 2. `domain`
 * 3. `type`
 */
export function findMatchingRule(
  url: string,
  type: string,
  rules: NormalizedRuntimeRetryOptions[],
): NormalizedRuntimeRetryOptions | null {
  for (let i = 0; i < rules.length; i++) {
    // Check test condition
    const rule = rules[i];
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

    if (rule.domain && rule.domain.length > 0) {
      const domain = findCurrentDomain(url, rule);
      if (!rule.domain.includes(domain)) {
        shouldMatch = false;
      }
    }

    if (rule.type && rule.type.length > 0) {
      if (!rule.type.includes(type)) shouldMatch = false;
    }

    if (!shouldMatch) {
      continue;
    }
    return rule;
  }

  return null;
}
