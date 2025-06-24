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

test('should not retry when no rules match', async ({ page }) => {
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

  // Should not retry when no rules match
  await expect(compTestElement).toHaveText(
    /ChunkLoadError: Loading chunk src_AsyncCompTest_tsx from/,
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

test('should work with function tester in multiple rules for initial chunks (CSS)', async ({ page }) => {
  const { logs, restore } = proxyConsole();
  const blockedMiddleware = createBlockMiddleware({
    blockNum: 2, // Block 2 times so we can see retry behavior
    urlPrefix: '/static/css/index.css',
  });

  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, [
    {
      // This function should return false for CSS files, so rule should be skipped
      test: (url: string) => url.includes('NonExistentPattern'),
      max: 1,
      type: ['link'],
      onRetry(context) {
        console.info('onRetry', context);
      },
      onFail(context) {
        console.info('onFail', context);
      },
    },
    {
      // This function should return true and match the CSS file
      test: (url: string) => url.includes('.css'),
      max: 2,
      type: ['link'],
      onRetry(context) {
        console.info('onRetry', context);
      },
      onSuccess(context) {
        console.info('onSuccess', context);
      },
    },
  ]);

  const { onRetryContextList, onSuccessContextList } = await proxyPageConsole(
    page,
    rsbuild.port,
  );

  await gotoPage(page, rsbuild);
  await delay(1000);

  // Should retry 2 times with the second rule (function that returns true) and then succeed
  expect(onRetryContextList).toHaveLength(2);
  expect(onSuccessContextList).toHaveLength(1);
  expect(onSuccessContextList[0].times).toBe(2);

  // Verify the CSS file was loaded correctly
  const compTestElement = page.locator('#comp-test');
  await expect(compTestElement).toHaveText('Hello CompTest');

  await rsbuild.server.close();
  restore();
});