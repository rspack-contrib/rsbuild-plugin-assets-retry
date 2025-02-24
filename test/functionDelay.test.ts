import { gotoPage, proxyConsole } from './helper';
import { expect, test } from '@playwright/test';
import { logger } from '@rsbuild/core';
import { createBlockMiddleware, createRsbuildWithMiddleware } from './helper';

test('should apply function delay for async chunk retries', async ({
  page,
}) => {
  logger.level = 'verbose';
  const { restore } = proxyConsole();
  const timestamps: number[] = [];

  const delayFn = (times: number) => times * 1000;

  const blockedMiddleware = createBlockMiddleware({
    blockNum: 3,
    urlPrefix: '/static/js/async/src_AsyncCompTest_tsx.js',
    onBlock: (ctx) => {
      timestamps.push(ctx.timestamp);
    },
  });
  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, {
    // times: 0, 1, 2
    delay: (ctx) => (ctx.times + 1) * 1000,
  });
  await gotoPage(page, rsbuild);

  await expect
    .poll(() => timestamps.length, {
      timeout: 10000,
    })
    .toBe(3);

  // Verify the time interval (allow ±200ms error)
  for (let i = 1; i < timestamps.length; i++) {
    const actual = timestamps[i] - timestamps[i - 1];
    const expected = delayFn(i);
    expect(actual).toBeGreaterThanOrEqual(expected - 300);
    expect(actual).toBeLessThanOrEqual(expected + 300);
  }
  const compTestElement = page.locator('#comp-test');
  await expect(compTestElement).toHaveText('Hello CompTest');
  await rsbuild.server.close();
  restore();
  logger.level = 'log';
});
