import { createServer } from 'vite';
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-dev-'));
const server = await createServer();
await server.listen();
let app;
const modes = [];
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
  modes.push('isolated empty profile');
  await app.close();
  app = null;
  const flowData = path.join(base, 'flow-profile');
  await fs.mkdir(flowData);
  const flowEnv = { ...env, FILECANVAS_TEST_PROFILE: '1', FILECANVAS_TEST_DATA: flowData };
  delete flowEnv.FILECANVAS_E2E;
  app = await electron.launch({ args: ['.'], env: flowEnv, timeout: 30000 });
  const flowPage = await app.firstWindow();
  flowPage.on('pageerror', (e) => errors.push(e.message));
  await expect(flowPage.locator('.breadcrumb')).toContainText('6 文件试用');
  await expect(flowPage.locator('.statusbar')).toContainText('6 个文件');
  await expect(flowPage.locator('[data-name="待整理"]')).toHaveAttribute('data-expanded', 'true');
  await expect(flowPage.locator('[data-name="已分类"]')).toHaveAttribute('data-expanded', 'true');
  await flowPage.locator('[data-name="拍摄方案.md"]').click();
  await expect(flowPage.locator('.text-preview')).toContainText('图书馆');
  await flowPage.screenshot({ path: '03_测试结果/dev-six-file-startup.png' });
  expect(errors).toEqual([]);
  modes.push('normal development startup: fresh six-file sample, expanded folders, local preview');
  await fs.writeFile(
    '03_测试结果/dev-smoke.json',
    JSON.stringify({ status: 'passed', url: flowPage.url(), modes, errors }, null, 2),
    'utf8',
  );
  console.log('Vite + Electron development startup passed.');
} finally {
  if (app) await app.close();
  await server.close();
}
