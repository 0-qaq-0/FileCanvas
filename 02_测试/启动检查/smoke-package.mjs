import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-package-'));
const env = { ...process.env, FILECANVAS_TEST_PROFILE: '1', FILECANVAS_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: '07_发布成品/win-unpacked/FileCanvas.exe',
  env,
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  await page.getByLabel('更多工具').click();
  await expect(page.getByRole('button', { name: /应用到硬盘/ })).toBeDisabled();
  await page.getByLabel('更多工具').click();
  await expect(page.getByRole('button', { name: '打开文件夹', exact: true })).toBeVisible();
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
  await page.locator('.main-header').screenshot({ path: '03_测试结果/packaged-startup.png' });
  let demoChecked = false;
  if (process.argv.includes('--demo')) {
    await page.getByLabel('更多工具').click();
    await page.getByRole('button', { name: '体验示例', exact: true }).click();
    await expect(page.locator('.statusbar')).toContainText('20 个文件 · 2 个文件夹');
    await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
    const restored = await page.evaluate(() => window.fileCanvas.restore());
    expect(restored.ok).toBe(true);
    const project = restored.data;
    const manifest = JSON.parse(
      await fs.readFile(path.join(path.dirname(project.rootPath), '样例清单.json'), 'utf8'),
    );
    await page.getByRole('button', { name: '分类草案', exact: true }).click();
    await page.getByRole('button', { name: '采用草案到画布' }).click();
    await expect(page.locator('.statusbar')).toContainText('20 个文件 · 6 个文件夹');
    await page.getByRole('button', { name: /预览变更/ }).click();
    await page.getByRole('button', { name: '结构对照', exact: true }).click();
    await expect(page.getByTestId('after-tree')).toContainText('02_创作素材');
    await page.getByRole('button', { name: '导出整理方案', exact: true }).click();
    await expect(page.locator('.export-result')).toBeVisible();
    for (const file of manifest.files)
      expect(
        createHash('sha256')
          .update(await fs.readFile(path.join(project.rootPath, file.path)))
          .digest('hex'),
      ).toBe(file.sha256);
    expect(await fs.readdir(project.rootPath)).not.toContain('01_策划资料');
    await page.getByRole('button', { name: '返回继续整理' }).click();
    await page.getByLabel('更多工具').click();
    await page.getByRole('button', { name: '体验示例', exact: true }).click();
    await expect(page.locator('.statusbar')).toContainText('20 个文件 · 2 个文件夹');
    demoChecked = true;
    console.log(
      'Packaged demo creation, draft, structure and export passed; original hashes preserved.',
    );
  }
  await fs.writeFile(
    '03_测试结果/package-smoke.json',
    JSON.stringify({ status: 'passed', restoredProject, demoChecked, ...runtime }, null, 2),
    'utf8',
  );
  console.log('Packaged Windows application smoke passed:', runtime);
} finally {
  await app.close();
}
