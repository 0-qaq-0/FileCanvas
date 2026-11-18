import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const previewRoot = path.resolve('test-results/简洁界面体验');
await fs.mkdir(previewRoot, { recursive: true });
const profile = await fs.mkdtemp(path.join(previewRoot, 'filecanvas-e2e-preview-'));
const env = {
  ...process.env,
  TEMP: previewRoot,
  TMP: previewRoot,
  FILECANVAS_TEST_PROFILE: '1',
  FILECANVAS_TEST_DATA: profile,
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.FILECANVAS_DEV_URL;
delete env.FILECANVAS_E2E;
delete env.FILECANVAS_TEST_ROOT;
const app = await electron.launch({ args: ['.'], env, cwd: process.cwd() });
const showContextMenu = process.argv.includes('--context-menu');
const page = await app.firstWindow();
await page.getByRole('button', { name: '试用示例文件', exact: true }).click();
await page.getByTestId('save-state').filter({ hasText: '项目已保存' }).waitFor();
const toast = page.getByRole('button', { name: '关闭提示', exact: true });
if (await toast.isVisible()) await toast.click();
await app.evaluate(({ BrowserWindow }, showContextMenu) => {
  const window = BrowserWindow.getAllWindows()[0];
  window.setTitle(`FileCanvas · 简洁界面体验${showContextMenu ? ' · 右键菜单' : ''}`);
  window.show();
  window.focus();
}, showContextMenu);
if (showContextMenu)
  await page
    .locator('[data-testid="canvas-card"]:not(.is-folder)')
    .first()
    .click({ button: 'right' });
console.log('简洁界面已打开，使用项目内的独立体验数据和虚构示例。关闭窗口即可结束。');
await new Promise((resolve) => app.on('close', resolve));
