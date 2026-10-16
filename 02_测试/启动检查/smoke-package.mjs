import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: '07_发布成品/win-unpacked/FileCanvas.exe',
  env,
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  await expect(page.getByRole('button', { name: /应用到硬盘/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: '打开文件夹 / 新建项目' })).toBeVisible();
  const runtime = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    dataPath: app.getPath('userData'),
    name: app.getName(),
    version: app.getVersion(),
  }));
  expect(runtime.packaged).toBe(true);
  expect(runtime.name).toBe('FileCanvas');
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  // A packaged app may restore the user's saved project. Inspect the toolbar only;
  // never manipulate its files or capture the user's directory contents.
  const restoredProject = await page.locator('.browser-panel').isVisible();
  await page.locator('.toolbar').screenshot({ path: '03_测试结果/packaged-startup.png' });
  await fs.writeFile(
    '03_测试结果/package-smoke.json',
    JSON.stringify({ status: 'passed', restoredProject, ...runtime }, null, 2),
    'utf8',
  );
  console.log('Packaged Windows application smoke passed:', runtime);
} finally {
  await app.close();
}
