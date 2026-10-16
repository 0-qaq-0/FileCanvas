import { createServer } from 'vite';
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-dev-'));
const server = await createServer();
await server.listen();
let app;
try {
  const env = {
    ...process.env,
    FILECANVAS_DEV_URL: 'http://127.0.0.1:5173',
    FILECANVAS_E2E: '1',
    FILECANVAS_TEST_DATA: base,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await expect(page.getByRole('button', { name: '选择文件夹，开始整理' })).toBeVisible();
  expect(errors).toEqual([]);
  await fs.writeFile(
    '03_测试结果/dev-smoke.json',
    JSON.stringify({ status: 'passed', url: page.url(), errors }, null, 2),
    'utf8',
  );
  console.log('Vite + Electron development startup passed.');
} finally {
  if (app) await app.close();
  await server.close();
}
