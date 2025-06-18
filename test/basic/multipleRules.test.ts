import { expect, test } from '@playwright/test';
import { logger } from '@rsbuild/core';
import { gotoPage, proxyConsole } from './helper';
import {
  createBlockMiddleware,
  createRsbuildWithMiddleware,
  delay,
  getRandomPort,
  proxyPageConsole,
} from './helper';

test('should use different retry counts for different domains with multiple rules', async ({
  page,
}) => {
  logger.level = 'verbose';
  const { logs, restore } = proxyConsole();

  // Block async chunk requests
  const asyncChunkBlockedMiddleware = createBlockMiddleware({
    blockNum: 100,
    urlPrefix: '/static/js/async/src_AsyncCompTest_tsx.js',
  });

  const port = await getRandomPort();
  const rsbuild = await createRsbuildWithMiddleware(
    asyncChunkBlockedMiddleware,
    [
      {
        domain: [`localhost:${port}`],
        max: 2,
        test: 'AsyncCompTest',
        onRetry(context) {
          console.info('onRetry-rule1', context);
        },
        onFail(context) {
          console.info('onFail-rule1', context);
        },
      },
      {
        domain: ['cdn3.com'],
        max: 4,
        onRetry(context) {
          console.info('onRetry-rule2', context);
        },
        onFail(context) {
          console.info('onFail-rule2', context);
        },
      },
    ],
    undefined,
    port,
  );

  await gotoPage(page, rsbuild);
  const compTestElement = page.locator('#async-comp-test-error');

  // Should fail after 2 retries for localhost domain
  await expect(compTestElement).toHaveText(
    /ChunkLoadError: Loading chunk src_AsyncCompTest_tsx from "static\/js\/async\/src_AsyncCompTest_tsx\.js" failed after 2 retries/,
  );

  await rsbuild.server.close();
  restore();
  logger.level = 'log';
});

test('should match rules based on test pattern with multiple rules', async ({
  page,
}) => {
  const blockedMiddleware = createBlockMiddleware({
    blockNum: 100,
    urlPrefix: '/static/js/async/src_AsyncCompTest_tsx.js',
  });

  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, [
    {
      test: 'AsyncCompTest',
      max: 1,
      onRetry(context) {
        console.info('onRetry', context);
      },
      onFail(context) {
        console.info('onFail', context);
      },
    },
    {
      test: 'OtherChunk',
      max: 3,
      onRetry(context) {
        console.info('onRetry', context);
      },
      onFail(context) {
        console.info('onFail', context);
      },
    },
  ]);

  const { onRetryContextList, onFailContextList } = await proxyPageConsole(
    page,
    rsbuild.port,
  );

  await gotoPage(page, rsbuild);
  await delay(1000);

  // Should retry only once for AsyncCompTest matching pattern
  expect(onRetryContextList).toHaveLength(1);
  expect(onFailContextList).toHaveLength(1);
  expect(onFailContextList[0].times).toBe(1);

  await rsbuild.server.close();
});

test('should use default rule when no rules match', async ({ page }) => {
  const blockedMiddleware = createBlockMiddleware({
    blockNum: 100,
    urlPrefix: '/static/js/async/src_AsyncCompTest_tsx.js',
  });

  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, [
    {
      test: 'NonExistentPattern',
      max: 5,
    },
    {
      domain: ['non-existent-domain.com'],
      max: 6,
    },
  ]);

  await gotoPage(page, rsbuild);
  const compTestElement = page.locator('#async-comp-test-error');

  // Should use default max retries (3) when no rules match
  await expect(compTestElement).toHaveText(
    /ChunkLoadError: Loading chunk src_AsyncCompTest_tsx from "static\/js\/async\/src_AsyncCompTest_tsx\.js" failed after 3 retries/,
  );

  await rsbuild.server.close();
});

test('should match first rule when multiple rules could match', async ({
  page,
}) => {
  const blockedMiddleware = createBlockMiddleware({
    blockNum: 100,
    urlPrefix: '/static/js/async/src_AsyncCompTest_tsx.js',
  });

  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, [
    {
      test: 'AsyncCompTest',
      max: 2,
      onFail(context) {
        console.info('onFail-firstRule', context);
      },
    },
    {
      test: 'AsyncCompTest',
      max: 5,
      onFail(context) {
        console.info('onFail-secondRule', context);
      },
    },
  ]);

  await gotoPage(page, rsbuild);
  const compTestElement = page.locator('#async-comp-test-error');

  // Should use first matching rule (max: 2)
  await expect(compTestElement).toHaveText(
    /ChunkLoadError: Loading chunk src_AsyncCompTest_tsx from "static\/js\/async\/src_AsyncCompTest_tsx\.js" failed after 2 retries/,
  );

  await rsbuild.server.close();
});

test('should work with multiple rules for initial chunks', async ({ page }) => {
  const blockedMiddleware = createBlockMiddleware({
    blockNum: 100,
    urlPrefix: '/static/js/index.js',
  });

  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, [
    {
      test: 'index\\.js',
      max: 2,
      onRetry(context) {
        console.info('onRetry', context);
      },
      onFail(context) {
        console.info('onFail', context);
      },
    },
    {
      test: 'other\\.js',
      max: 4,
    },
  ]);

  const { onRetryContextList, onFailContextList } = await proxyPageConsole(
    page,
    rsbuild.port,
  );

  await gotoPage(page, rsbuild);
  await delay(1000);

  // Should retry 2 times for index.js
  expect(onRetryContextList).toHaveLength(2);
  expect(onFailContextList).toHaveLength(1);
  expect(onFailContextList[0].times).toBe(2);

  await rsbuild.server.close();
});
