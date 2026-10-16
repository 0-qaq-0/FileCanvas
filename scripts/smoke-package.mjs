import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: 'release/win-unpacked/FileCanvas.exe',
  env,
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  await expect(page.getByRole('button', { name: /应用到硬盘/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: '选择文件夹，开始整理' })).toBeVisible();
  const runtime = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    dataPath: app.getPath('userData'),
    name: app.getName(),
    version: app.getVersion(),
  }));
  expect(runtime.packaged).toBe(true);
  expect(runtime.name).toBe('FileCanvas');
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await page.screenshot({ path: 'test-results/packaged-startup.png' });
  await fs.writeFile(
    'test-results/package-smoke.json',
    JSON.stringify({ status: 'passed', ...runtime }, null, 2),
    'utf8',
  );
  console.log('Packaged Windows application smoke passed:', runtime);
} finally {
  await app.close();
}
