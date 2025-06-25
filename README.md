# @rsbuild/plugin-assets-retry

An Rsbuild plugin to automatically resend requests when static assets fail to load.

<p>
  <a href="https://npmjs.com/package/@rsbuild/plugin-assets-retry">
   <img src="https://img.shields.io/npm/v/@rsbuild/plugin-assets-retry?style=flat-square&colorA=564341&colorB=EDED91" alt="npm version" />
  </a>
  <img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square&colorA=564341&colorB=EDED91" alt="license" />
  <a href="https://npmcharts.com/compare/@rsbuild/plugin-assets-retry?minimal=true"><img src="https://img.shields.io/npm/dm/@rsbuild/plugin-assets-retry.svg?style=flat-square&colorA=564341&colorB=EDED91" alt="downloads" /></a>
</p>

English | [简体中文](./README.zh-CN.md)

## Quick start

### Install plugin

You can install the plugin using the following command:

```bash
# npm
npm add @rsbuild/plugin-assets-retry -D

# yarn
yarn add @rsbuild/plugin-assets-retry -D

# pnpm
pnpm add @rsbuild/plugin-assets-retry -D

# bun
bun add @rsbuild/plugin-assets-retry -D
```

### Register plugin

You can register the plugin in the `rsbuild.config.ts` file:

```ts
import { pluginAssetsRetry } from '@rsbuild/plugin-assets-retry';

export default {
  plugins: [pluginAssetsRetry()],
};
```

## Options

You can configure the retry behavior for assets retry through the options.

- **Type:**

```ts
type AssetsRetryHookContext = {
  times: number;
  domain: string;
  url: string;
  tagName: string;
  isAsyncChunk: boolean;
};

type AssetsRetryOptions = {
  type?: string[];
  domain?: string[];
  max?: number;
  test?: string | ((url: string) => boolean);
  crossOrigin?: boolean | 'anonymous' | 'use-credentials';
  inlineScript?: boolean;
  delay?: number | ((context: AssetsRetryHookContext) => number);
  onRetry?: (context: AssetsRetryHookContext) => void;
  onSuccess?: (context: AssetsRetryHookContext) => void;
  onFail?: (context: AssetsRetryHookContext) => void;
} | {
  rules: RuntimeRetryOptions[];
  inlineScript?: boolean;
  minify?: boolean;
};
```

- **Default:**

```ts
const defaultAssetsRetryOptions = {
  type: ['script', 'link', 'img'],
  domain: [],
  max: 3,
  test: '',
  crossOrigin: false,
  delay: 0,
  onRetry: () => {},
  onSuccess: () => {},
  onFail: () => {},
};
```

### domain

- **Type:** `string[]`
- **Default:** `[]`

Specifies the retry domain when assets fail to load. In the `domain` array, the first item is the default domain of static assets, and the following items are backup domains. When a asset request for a domain fails, Rsbuild will find that domain in the array and replace it with the next domain in the array.

For example:

```js
// rsbuild.config.ts
defineConfig({
  plugins: [
    pluginAssetsRetry({
      domain: ['cdn1.com', 'cdn2.com', 'cdn3.com'],
    }),
  ],
  output: {
    assetPrefix: 'https://cdn1.com', // or "//cdn1.com"
  },
});
```

After adding the above configuration, when assets fail to load from the `cdn1.com` domain, the request domain will automatically fallback to `cdn2.com`.

If the assets request for `cdn2.com` also fails, the request will fallback to `cdn3.com`.

### type

- **Type:** `string[]`
- **Default:** `['script', 'link', 'img']`

Used to specify the HTML tag types that need to be retried. By default, script tags, link tags, and img tags are processed, corresponding to JS code, CSS code, and images.

For example, only script tags and link tags are processed:

```js
pluginAssetsRetry({
  type: ['script', 'link'],
});
```

### max

- **Type:** `number`
- **Default:** `3`

The maximum number of retries for a single asset. For example:

```js
pluginAssetsRetry({
  max: 5,
});
```

### test

- **Type:** `string | ((url: string) => boolean) | undefined`
- **Default:** `undefined`

The test function of the asset to be retried. For example:

```js
pluginAssetsRetry({
  test: /cdn\.example\.com/,
});
```

### crossOrigin

- **Type:** `undefined | boolean | 'anonymous' | 'use-credentials'`
- **Default:** `same as html.crossorigin`

When initiating a retry for assets, Rsbuild will recreate the `<script>` tags. This option allows you to set the `crossorigin` attribute for these tags.

By default, the value of `crossOrigin` will be consistent with the `html.crossorigin` configuration, so no additional configuration is required. If you need to configure the recreated tags separately, you can use this option, for example:

```js
pluginAssetsRetry({
  crossOrigin: true,
});
```

### onRetry

- **Type:** `undefined | (context: AssetsRetryHookContext) => void`

The callback function when the asset is being retried. For example:

```js
pluginAssetsRetry({
  onRetry: ({ times, domain, url, tagName, isAsyncChunk }) => {
    console.log(
      `Retry ${times} times, domain: ${domain}, url: ${url}, tagName: ${tagName}, isAsyncChunk: ${isAsyncChunk}`,
    );
  },
});
```

### onSuccess

- **Type:** `undefined | (context: AssetsRetryHookContext) => void`

The callback function when the asset is successfully retried. For example:

```js
pluginAssetsRetry({
  onSuccess: ({ times, domain, url, tagName, isAsyncChunk }) => {
    console.log(
      `Retry ${times} times, domain: ${domain}, url: ${url}, tagName: ${tagName}, isAsyncChunk: ${isAsyncChunk}`,
    );
  },
});
```

### onFail

- **Type:** `undefined | (context: AssetsRetryHookContext) => void`

The callback function when the asset is failed to be retried. For example:

```js
pluginAssetsRetry({
  onFail: ({ times, domain, url, tagName, isAsyncChunk }) => {
    console.log(
      `Retry ${times} times, domain: ${domain}, url: ${url}, tagName: ${tagName}, isAsyncChunk: ${isAsyncChunk}`,
    );
  },
});
```

### addQuery

- **Type:**

```ts
type AddQuery =
  | boolean
  | ((context: { times: number; originalQuery: string }) => string);
```

- **Default:** `false`

Whether to add query when retrying resources, so as to avoid being affected by browser and CDN caches on the retry results.

When set to `true`, `retry=${times}` will be added to the query when requesting, and requests will be made in sequence according to `retry=1`, `retry=2`, `retry=3` etc, for example:

1. Assume that the requested asset is `https://js.cdn.net/foo.js`. If the request fails, it will automatically retry `https://js.cdn.net/foo.js?retry=${times}`

2. Assume that the requested asset is `https://js.cdn.net/foo.js?version=1`. If the request fails, it will automatically retry `https://js.cdn.net/foo.js?version=1&retry=${times}`

When you want to customize query, you can pass a function, for example:

- **Example:** All assets requested do not contain query:

```js
pluginAssetsRetry({
  addQuery: ({ times }) => {
    return times === 3
      ? `?retryCount=${times}&isLast=1`
      : `?retryCount=${times}`;
  },
});
```

- **Example:** If there is a query in some of the requested assets, you can read it with `originalQuery`:

```js
pluginAssetsRetry({
  addQuery: ({ times, originalQuery }) => {
    const query =
      times === 3 ? `retryCount=${times}&isLast=1` : `retryCount=${times}`;
    return originalQuery ? `${originalQuery}&${query}` : `?${query}`;
  },
});
```

### inlineScript

- **Type:** `boolean`
- **Default:** `true`

Whether to inline the runtime JavaScript code of Assets Retry plugin into the HTML file.

If you don't want to insert the code in the HTML file, you can set `inlineScript` to `false`:

```js
pluginAssetsRetry({
  inlineScript: false,
});
```

After adding the above configuration, the runtime code of Assets Retry plugin will be extracted into a separate `assets-retry.[version].js` file and output to the dist directory.

The downside is that `assets-retry.[version].js` itself may fail to load. If this happens, the assets retry will not work. Therefore, we prefer to inline the runtime code into the HTML file.

### minify

- **Type:** `boolean`
- **Default:** `process.env.NODE_ENV === 'production'`

Configure whether to enable code minification for runtime JavaScript code.

By default, it will be affected by the [output.minify](/config/output/minify) configuration.

```js
pluginAssetsRetry({
  minify: true,
});
```

### delay

- **Type:** `number | ((context: AssetsRetryHookContext) => number)`
- **Default:** `0`

The delay time (in milliseconds) before retrying a failed asset.

You can pass a number:

```js
// Delay 1s before retrying
pluginAssetsRetry({
  delay: 1000,
});
```

Or pass a function that receives `AssetsRetryHookContext` and returns the delay time:

```js
// Calculate delay based on retry attempts
pluginAssetsRetry({
  delay: ctx => (ctx.times + 1) * 1000,
});
```

### rules

- **Type:** `RuntimeRetryOptions[]`
- **Default:** `undefined`

Configure multiple retry rules with different options. Each rule will be evaluated in order, and the first matching rule will be used for retry logic. This is useful when you have different retry requirements for different types of assets or domains.

When using `rules`, the plugin will:
1. Check each rule in order
2. Use the first rule whose `test` condition matches the asset URL
3. If no rule matches, the asset will not be retried

Each rule supports all the same options as the top-level configuration, including `type`, `domain`, `max`, `test`, `crossOrigin`, `delay`, `onRetry`, `onSuccess`, and `onFail`.

Example - Different retry strategies for different CDNs:

```js
pluginAssetsRetry({
  rules: [
    {
      // Rule for primary CDN
      test: /cdn1\.example\.com/,
      domain: ['cdn1.example.com', 'cdn1-backup.example.com'],
      max: 3,
      delay: 1000,
    },
    {
      // Rule for secondary CDN with more retries
      test: /cdn2\.example\.com/,
      domain: ['cdn2.example.com', 'cdn2-backup.example.com'],
      max: 5,
      delay: 500,
    },
    {
      // Default rule for other assets
      domain: ['default.example.com', 'default-backup.example.com'],
      max: 2,
    },
  ],
});
```

Example - Different retry strategies for different asset types:

```js
pluginAssetsRetry({
  rules: [
    {
      // Critical JavaScript files get more retries
      test: /\.js$/,
      max: 5,
      delay: 1000,
      onFail: ({ url }) => console.error(`Critical JS failed: ${url}`),
    },
    {
      // CSS files get fewer retries
      test: /\.css$/,
      max: 2,
      delay: 500,
    },
    {
      // Images get minimal retries
      test: /\.(png|jpg|gif|svg)$/,
      max: 1,
      delay: 0,
    },
  ],
});
```

## Notes

When you use Assets Retry plugin, the Rsbuild injects some runtime code into the HTML and [Rspack Runtime](https://rspack.dev/misc/glossary#runtime), then serializes the Assets Retry plugin config, inserting it into the runtime code. Therefore, you need to be aware of the following:

- Avoid configuring sensitive information in Assets Retry plugin, such as internal tokens.
- Avoid referencing variables or methods outside of `onRetry`, `onSuccess`, and `onFail`.
- Avoid using syntax with compatibility issues in `onRetry`, `onSuccess` and `onFail` as these functions are inlined directly into the HTML.

Here's an example of incorrect usage:

```js
import { someMethod } from 'utils';

pluginAssetsRetry({
  onRetry() {
    // Incorrect usage, includes sensitive information
    const privateToken = 'a-private-token';

    // Incorrect usage, uses an external method
    someMethod(privateToken);
  },
});
```

## Limitation

Assets Retry plugin may not work in the following scenarios:

### Sync script tag loaded resources

`<script src="..."></script>` tags load resources synchronously, and retrying them does not guarantee the order of resource loading. Therefore, the Assets Retry plugin will not retry resources loaded by synchronous script tags. It will only retry resources loaded by async/defer script tags.

### Module Federation

For remote modules loaded by Module Federation, you can use the [@module-federation/retry-plugin](https://www.npmjs.com/package/@module-federation/retry-plugin) from Module Federation 2.0 to implement static asset retries.

### Micro-frontend

If your project is a micro-frontend application (such as a Garfish sub-application), the assets retry may not work because micro-frontend sub-applications are typically not loaded directly based on the `<script>` tag.

If you need to retry assets in micro-frontend scenarios, please contact the developers of the micro-frontend framework to find a solution.

### Assets in custom templates

Assets Retry plugin listens to the page error event to know whether the current resource fails to load and needs to be retried. Therefore, if the resource in the custom template is executed earlier than Assets Retry plugin, then Assets Retry plugin cannot listen to the event that the resource fails to load, so it will not be retried.

If you want Assets Retry plugin to work on resources in custom templates, you can refer to [Custom Insertion Example](https://github.com/rspack-contrib/html-rspack-plugin/tree/main/examples/custom-insertion-position) to modify [html.inject](/config/html/inject) configuration and custom template.

```diff
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>custom template</title>
+   <%= htmlPlugin.tags.headTags %>
    <script src="https://example.com/assets/a.js"></script>
  </head>
  <body>
    <div id="root" />
+    <%= htmlPlugin.tags.bodyTags %>
  </body>
</html>
```

## License

[MIT](./LICENSE).
