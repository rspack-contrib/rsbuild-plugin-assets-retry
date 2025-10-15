import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createRsbuild } from '@rsbuild/core';

const build = async () => {
  const rsbuild = await createRsbuild({
    cwd: import.meta.dirname,
  });
  await rsbuild.build();
};

test('should not work in node environment', async () => {
  await build();

  // dist/server only contains one file
  expect((await fs.readdir('dist/server')).length).toBe(1);
  // only dist/server/index.js exists
  expect(
    await fs.access('dist/server/index.js').then(
      () => true,
      () => false,
    ),
  ).toBe(true);

  // dist/static/js contains two files, index.js and assets-retry.js
  expect((await fs.readdir('dist/static/js')).length).toBe(2);
  // index.js contains "registerAsyncChunkRetry" function calling
  expect(await fs.readFile('dist/static/js/index.js', 'utf-8')).toContain(
    'registerAsyncChunkRetry',
  );
});
