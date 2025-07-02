import { expect, test } from '@playwright/test';
import { logger } from '@rsbuild/core';
import {
  count404Response,
  createBlockMiddleware,
  createRsbuildWithMiddleware,
  delay,
  gotoPage,
  proxyConsole,
  proxyPageConsole,
} from './helper';

test('should support multiple retry rules', async ({ page }) => {
  logger.level = 'verbose';
  const { logs, restore } = proxyConsole();

  // Block first 2 requests for JS files, first 1 request for CSS files
  const jsBlockedMiddleware = createBlockMiddleware({
    blockNum: 2,
    urlPrefix: '/static/js/',
  });

  const cssBlockedMiddleware = createBlockMiddleware({
    blockNum: 1,
    urlPrefix: '/static/css/',
  });

  const rsbuild = await createRsbuildWithMiddleware(
    [jsBlockedMiddleware, cssBlockedMiddleware],
    {
      rules: [
        {
          // Rule for JS files - allow 2 retries
          test: '\\.js$',
          max: 2,
          delay: 100,
          onRetry(context) {
            console.info('onRetry', context);
          },
          onSuccess(context) {
            console.info('onSuccess', context);
          },
        },
        {
          // Rule for CSS files - allow 1 retry
          test: '\\.css$',
          max: 1,
          delay: 50,
          onRetry(context) {
            console.info('onRetry', context);
          },
          onSuccess(context) {
            console.info('onSuccess', context);
          },
        },
        {
          // Default rule for other assets - no retry
          max: 0,
        },
      ],
    },
  );

  const { onRetryContextList, onSuccessContextList } = await proxyPageConsole(
    page,
    rsbuild.port,
  );

  await gotoPage(page, rsbuild);
  const compTestElement = page.locator('#comp-test');
  await expect(compTestElement).toHaveText('Hello CompTest');
  await delay();

  // Check JS retries (should retry 2 times)
  const jsBlockedResponseCount = count404Response(logs, '/static/js/');
  expect(jsBlockedResponseCount).toBeGreaterThanOrEqual(2);

  // Check CSS retries (should retry 1 time)
  const cssBlockedResponseCount = count404Response(logs, '/static/css/');
  expect(cssBlockedResponseCount).toBeGreaterThanOrEqual(1);

  // Check retry contexts
  const jsRetries = onRetryContextList.filter((ctx) => ctx.url.includes('.js'));
  const cssRetries = onRetryContextList.filter((ctx) =>
    ctx.url.includes('.css'),
  );

  expect(jsRetries.length).toBeGreaterThanOrEqual(2);
  expect(cssRetries.length).toBeGreaterThanOrEqual(1);

  // Check success contexts
  const jsSuccess = onSuccessContextList.filter((ctx) =>
    ctx.url.includes('.js'),
  );
  const cssSuccess = onSuccessContextList.filter((ctx) =>
    ctx.url.includes('.css'),
  );

  expect(jsSuccess.length).toBeGreaterThanOrEqual(1);
  expect(cssSuccess.length).toBeGreaterThanOrEqual(1);

  await rsbuild.server.close();
  restore();
  logger.level = 'log';
});

test('should match rules by test function', async ({ page }) => {
  logger.level = 'verbose';
  const { logs, restore } = proxyConsole();

  const blockedMiddleware = createBlockMiddleware({
    blockNum: 100, // Block all requests to ensure failure
    urlPrefix: '/static/js/async/src_AsyncCompTest_tsx.js',
  });

  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, {
    rules: [
      {
        // this rule should not match
        test: () => false,
      },
      {
        // Use function test for async chunks
        test: (url) => url.includes('async/'),
        max: 3,
        onRetry(context) {
          console.info('onRetry', context);
        },
        onFail(context) {
          console.info('onFail', context);
        },
      },
      {
        // Default rule
        max: 1,
      },
    ],
  });

  const { onRetryContextList, onFailContextList, onSuccessContextList } =
    await proxyPageConsole(page, rsbuild.port);

  await gotoPage(page, rsbuild);
  await delay();

  // Wait for the async component error to appear
  const asyncCompTestElement = page.locator('#async-comp-test-error');
  await expect(asyncCompTestElement).toHaveText(
    /ChunkLoadError: Loading chunk src_AsyncCompTest_tsx from "static\/js\/async\/src_AsyncCompTest_tsx\.js" failed after 3 retries/,
  );

  // Should retry 3 times based on the rule
  const blockedResponseCount = count404Response(
    logs,
    '/static/js/async/src_AsyncCompTest_tsx.js',
  );
  expect(blockedResponseCount).toBe(4); // 1 initial + 3 retries

  // Check contexts
  expect({
    onRetryContextList,
    onFailContextList,
    onSuccessContextList,
  }).toMatchObject({
    onFailContextList: [
      {
        domain: '<ORIGIN>',
        isAsyncChunk: true,
        tagName: 'script',
        times: 3,
        url: '<ORIGIN>/static/js/async/src_AsyncCompTest_tsx.js',
      },
    ],
    onRetryContextList: [
      {
        domain: '<ORIGIN>',
        isAsyncChunk: true,
        tagName: 'script',
        times: 0,
        url: '<ORIGIN>/static/js/async/src_AsyncCompTest_tsx.js',
      },
      {
        domain: '<ORIGIN>',
        isAsyncChunk: true,
        tagName: 'script',
        times: 1,
        url: '<ORIGIN>/static/js/async/src_AsyncCompTest_tsx.js',
      },
      {
        domain: '<ORIGIN>',
        isAsyncChunk: true,
        tagName: 'script',
        times: 2,
        url: '<ORIGIN>/static/js/async/src_AsyncCompTest_tsx.js',
      },
    ],
    onSuccessContextList: [],
  });

  await rsbuild.server.close();
  restore();
  logger.level = 'log';
});

test('should use first matching rule when multiple rules match', async ({
  page,
}) => {
  logger.level = 'verbose';
  const { logs, restore } = proxyConsole();

  // Block 3 requests to ensure retries happen
  const blockedMiddleware = createBlockMiddleware({
    blockNum: 3,
    urlPrefix: '/static/js/index.js',
  });

  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, {
    rules: [
      {
        type: ['link'],
        max: 1,
      },
      {
        test: /\.css$/,
        max: 1,
      },
      {
        // First rule - matches all .js files
        test: /\.js$/,
        max: 3,
        delay: 100,
        onRetry(context) {
          console.info('onRetry', context);
        },
        onSuccess(context) {
          console.info('onSuccess', context);
        },
        onFail(context) {
          console.info('onFail', context);
        },
      },
    ],
  });

  const { onRetryContextList, onSuccessContextList, onFailContextList } =
    await proxyPageConsole(page, rsbuild.port);

  await gotoPage(page, rsbuild);
  const compTestElement = page.locator('#comp-test');
  await expect(compTestElement).toHaveText('Hello CompTest');
  await delay();

  // Should retry 3 times
  const blockedResponseCount = count404Response(logs, '/static/js/index.js');
  expect(blockedResponseCount).toBe(3);

  // Check callbacks were triggered
  expect({
    onRetryContextList,
    onSuccessContextList,
    onFailContextList,
  }).toMatchObject({
    onFailContextList: [],
    onRetryContextList: [
      {
        domain: '<ORIGIN>',
        isAsyncChunk: false,
        tagName: 'script',
        times: 0,
        url: '<ORIGIN>/static/js/index.js',
      },
      {
        domain: '<ORIGIN>',
        isAsyncChunk: false,
        tagName: 'script',
        times: 1,
        url: '<ORIGIN>/static/js/index.js',
      },
      {
        domain: '<ORIGIN>',
        isAsyncChunk: false,
        tagName: 'script',
        times: 2,
        url: '<ORIGIN>/static/js/index.js',
      },
    ],
    onSuccessContextList: [
      {
        domain: '<ORIGIN>',
        isAsyncChunk: false,
        tagName: 'script',
        times: 3,
        url: '<ORIGIN>/static/js/index.js',
      },
    ],
  });

  await rsbuild.server.close();
  restore();
  logger.level = 'log';
});

test('should support rules with different domains', async ({ page }) => {
  logger.level = 'verbose';
  const { restore } = proxyConsole();

  // Use different ports for different domains
  const port = 15000 + Math.floor(Math.random() * 10000);

  const blockedMiddleware = createBlockMiddleware({
    blockNum: 4,
    urlPrefix: '/static/',
  });

  const rsbuild = await createRsbuildWithMiddleware(
    blockedMiddleware,
    {
      rules: [
        {
          test: /\.css$/,
          domain: [`localhost:${port}`, `localhost:${port + 1}`],
          max: 4,
        },
        {
          test: /\.js$/,
          domain: [`localhost:${port}`, `localhost:${port + 2}`],
          max: 4,
        },
      ],
    },
    undefined,
    port,
  );

  await gotoPage(page, rsbuild);
  const compTestElement = page.locator('#comp-test');
  await expect(compTestElement).toHaveText('Hello CompTest');

  await rsbuild.server.close();
  restore();
  logger.level = 'log';
});

test('should fall back to no retry when no rule matches', async ({ page }) => {
  logger.level = 'verbose';
  const { logs, restore } = proxyConsole();

  const blockedMiddleware = createBlockMiddleware({
    blockNum: 100, // Block all requests
    urlPrefix: '/static/js/index.js',
  });

  const rsbuild = await createRsbuildWithMiddleware(blockedMiddleware, {
    rules: [
      {
        // Only match CSS files
        test: /\.css$/,
        max: 3,
      },
      {
        // Only match async chunks
        test: 'async/',
        max: 3,
      },
    ],
  });

  // Set a timeout for the page load since it will fail
  try {
    await gotoPage(page, rsbuild);
    // Wait a bit to ensure no retries happen
    await page.waitForTimeout(1000);
  } catch (error) {
    // Expected to fail loading
  }

  // Should not retry since no rule matches
  const blockedResponseCount = count404Response(logs, '/static/js/index.js');
  expect(blockedResponseCount).toBe(1); // Only initial request, no retries

  await rsbuild.server.close();
  restore();
  logger.level = 'log';
});
