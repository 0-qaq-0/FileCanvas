import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const results = `03_测试结果/${version}打包验收`;
await fs.mkdir(results, { recursive: true });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-package-'));
const env = { ...process.env, FILECANVAS_TEST_PROFILE: '1', FILECANVAS_TEST_DATA: profile };
delete env.ELECTRON_RUN_AS_NODE;
delete env.FILECANVAS_DEV_URL;
const app = await electron.launch({
  executablePath: '07_发布成品/win-unpacked/FileCanvas.exe',
  env,
  timeout: 30000,
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('button', { name: '选择文件夹，开始整理' })).toBeVisible();
  const runtime = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    dataPath: app.getPath('userData'),
    name: app.getName(),
    version: app.getVersion(),
  }));
  expect(runtime.packaged).toBe(true);
  expect(runtime.name).toBe('FileCanvas');
  expect(runtime.version).toBe(version);
  expect(runtime.dataPath).toBe(profile);
  expect(page.url()).toMatch(/^file:/);
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  // All samples and disk changes stay inside this run's isolated temporary profile.
  await page.screenshot({ path: `${results}/01-欢迎页.png` });
  let demoChecked = false;
  if (process.argv.includes('--demo')) {
    await page.getByRole('button', { name: '先用 20 个示例文件试一遍' }).click();
    await expect(page.locator('.statusbar')).toContainText('20 个文件 · 2 个文件夹');
    await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
    const restored = await page.evaluate(() => window.fileCanvas.restore());
    expect(restored.ok).toBe(true);
    const project = restored.data;
    expect(path.relative(profile, project.rootPath)).not.toMatch(/^\.\./);
    const originalTree = (await fs.readdir(project.rootPath, { recursive: true })).sort();
    const manifest = JSON.parse(
      await fs.readFile(path.join(path.dirname(project.rootPath), '样例清单.json'), 'utf8'),
    );
    await page.screenshot({ path: `${results}/02-文件画布.png` });
    await page.getByRole('button', { name: '分类草案', exact: true }).click();
    await page.getByRole('button', { name: '采用草案到画布' }).click();
    await expect(page.locator('.statusbar')).toContainText('20 个文件 · 6 个文件夹');
    await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
    const planned = (await page.evaluate(() => window.fileCanvas.restore())).data;
    const targetPath = (id) => {
      const parts = [];
      for (let node = planned.nodes[id]; node; node = planned.nodes[node.parentId])
        parts.unshift(node.name);
      return path.join(project.rootPath, ...parts);
    };
    // Adopting a draft must leave both source paths and bytes unchanged.
    for (const file of manifest.files)
      expect(
        createHash('sha256')
          .update(await fs.readFile(path.join(project.rootPath, file.path)))
          .digest('hex'),
      ).toBe(file.sha256);
    expect((await fs.readdir(project.rootPath, { recursive: true })).sort()).toEqual(originalTree);
    await page.getByRole('button', { name: /检查并应用/ }).click();
    await page.getByRole('button', { name: '结构对照', exact: true }).click();
    await expect(page.getByTestId('after-tree')).toContainText('02_创作素材');
    await page.screenshot({ path: `${results}/03-应用前结构对照.png` });
    await page.getByRole('button', { name: '导出整理方案', exact: true }).click();
    await expect(page.locator('.export-result')).toBeVisible();
    for (const file of manifest.files)
      expect(
        createHash('sha256')
          .update(await fs.readFile(path.join(project.rootPath, file.path)))
          .digest('hex'),
      ).toBe(file.sha256);
    expect(await fs.readdir(project.rootPath)).not.toContain('01_策划资料');
    await page.getByRole('button', { name: '应用到本地文件', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('已应用并核验');
    await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
    const applied = await page.evaluate(() => window.fileCanvas.restore());
    expect(applied.ok).toBe(true);
    let moved = 0;
    for (const node of Object.values(project.nodes).filter((node) => node.kind === 'file')) {
      const current = targetPath(node.id);
      expect(Object.values(applied.data.nodes).some((item) => item.source?.path === current)).toBe(
        true,
      );
      const original = manifest.files.find(
        (file) => path.resolve(project.rootPath, file.path) === node.source.path,
      );
      expect(original).toBeDefined();
      expect(
        createHash('sha256')
          .update(await fs.readFile(current))
          .digest('hex'),
      ).toBe(original.sha256);
      if (current !== node.source.path) {
        moved++;
        await expect(fs.stat(node.source.path)).rejects.toMatchObject({ code: 'ENOENT' });
      }
    }
    expect(moved).toBe(16);
    await page.screenshot({ path: `${results}/04-真实移动完成.png` });
    await page.getByRole('button', { name: '恢复上次文件移动', exact: true }).click();
    await page.getByRole('button', { name: '恢复文件原位置', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('恢复到原位置');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    for (const file of manifest.files)
      expect(
        createHash('sha256')
          .update(await fs.readFile(path.join(project.rootPath, file.path)))
          .digest('hex'),
      ).toBe(file.sha256);
    expect((await fs.readdir(project.rootPath, { recursive: true })).sort()).toEqual(originalTree);
    await expect(page.locator('.statusbar')).toContainText('20 个文件 · 2 个文件夹');
    await page.screenshot({ path: `${results}/05-恢复原位置.png` });
    demoChecked = true;
    console.log(
      'Packaged demo, preview, export, 16 real file moves and recovery passed; all 20 file hashes preserved.',
    );
  }
  expect(errors).toEqual([]);
  await fs.writeFile(
    `${results}/package-smoke.json`,
    JSON.stringify(
      { status: 'passed', checkedAt: new Date().toISOString(), demoChecked, errors, ...runtime },
      null,
      2,
    ),
    'utf8',
  );
  console.log('Packaged Windows application smoke passed:', runtime);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: `${results}/failure.png` }).catch(() => {});
  await fs.writeFile(
    `${results}/package-smoke.json`,
    JSON.stringify({ status: 'failed', error: String(error) }, null, 2),
    'utf8',
  );
  throw error;
} finally {
  await app.close();
}
