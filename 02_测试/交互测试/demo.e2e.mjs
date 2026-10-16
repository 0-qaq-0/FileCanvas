import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-demo-'));
const data = path.join(base, '应用数据');
await fs.mkdir(data);
const env = { ...process.env, FILECANVAS_E2E: '1', FILECANVAS_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const assertions = [];
const errors = [];
let app;
function pass(message) {
  assertions.push(message);
  console.log(`PASS ${message}`);
}
async function fingerprint(root) {
  const result = {};
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      const stat = await fs.stat(full);
      result[path.relative(root, full)] = item.isDirectory()
        ? 'folder'
        : `${stat.size}:${stat.mtimeMs}:${createHash('sha256')
            .update(await fs.readFile(full))
            .digest('hex')}`;
      if (item.isDirectory()) await walk(full);
    }
  }
  await walk(root);
  return result;
}
await fs.mkdir('03_测试结果', { recursive: true });
try {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '先用 20 个示例文件试一遍' }).click();
  await expect(page.locator('.statusbar')).toContainText('20 个文件 · 2 个文件夹');
  await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
  const records = await page.evaluate(() => window.fileCanvas.projects());
  const first = records.data[0];
  const root = first.rootPath;
  const before = await fingerprint(root);
  const projectFile = path.join(data, 'projects', `${first.id}.json`);
  async function project() {
    await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
    return JSON.parse(await fs.readFile(projectFile, 'utf8'));
  }
  const card = (name) => page.locator(`[data-testid="canvas-card"][data-name="${name}"]`);
  const p0 = await project();
  const cover = Object.values(p0.nodes).find(
    (n) => n.name === '封面草稿.png' && n.parentId === null,
  );
  await page.locator('.canvas-scroll').evaluate((el, pos) => {
    el.scrollTop = Math.max(0, pos.y - 70);
    el.scrollLeft = Math.max(0, pos.x - 80);
  }, cover);
  await expect(card('封面草稿.png')).toBeVisible();
  await card('封面草稿.png').click();
  await expect(page.getByTestId('path-inspector')).toContainText('路径未变');
  const r = await card('封面草稿.png').boundingBox();
  await page.mouse.move(r.x + 50, r.y + 50);
  await page.mouse.down();
  await page.mouse.move(r.x + 70, r.y + 65, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId('path-inspector')).toContainText('路径未变');
  const p1 = await project();
  expect(p1.nodes[cover.id].x).not.toBe(cover.x);
  expect(p1.nodes[cover.id].parentId).toBeNull();
  pass('软件内创建真实 20 文件演示副本；自由拖动只改坐标，双路径仍相同');
  await page.getByRole('button', { name: '分类草案', exact: true }).click();
  const draft = page.getByRole('dialog', { name: '先生成一份分类草案' });
  await expect(draft).toContainText('16 个文件');
  await expect(draft).toContainText('规则依据文件名');
  await expect(draft).toContainText('99_待确认');
  expect(await fingerprint(root)).toEqual(before);
  if (await page.getByRole('button', { name: '关闭提示', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.screenshot({ path: '03_测试结果/demo-draft.png' });
  await page.getByRole('button', { name: '采用草案到画布' }).click();
  await expect(page.locator('.statusbar')).toContainText('20 个文件 · 6 个文件夹');
  const adopted = await project();
  expect(adopted.nodes[cover.id].parentId).not.toBeNull();
  await page.keyboard.press('Control+z');
  await expect(page.locator('.statusbar')).toContainText('20 个文件 · 2 个文件夹');
  expect((await project()).nodes).toEqual(p1.nodes);
  await page.keyboard.press('Control+y');
  await expect(page.locator('.statusbar')).toContainText('20 个文件 · 6 个文件夹');
  pass('分类理由可见，采用草案只改虚拟结构，整份草案一步撤销/重做');
  await card('02_创作素材').dblclick();
  await card('封面草稿.png').click();
  await expect(page.getByTestId('path-inspector')).toContainText('02_创作素材/封面草稿.png');
  await expect(page.getByTestId('path-inspector')).toContainText('尚未执行');
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  await page.getByRole('button', { name: /预览变更/ }).click();
  await page.getByRole('button', { name: '结构对照', exact: true }).click();
  await expect(page.getByTestId('before-tree')).not.toContainText('02_创作素材');
  await expect(page.getByTestId('after-tree')).toContainText('02_创作素材');
  await expect(page.getByTestId('before-tree')).toContainText('旧资料');
  await expect(page.getByTestId('after-tree')).toContainText('旧资料');
  if (await page.getByRole('button', { name: '关闭提示', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.screenshot({ path: '03_测试结果/demo-structure.png' });
  await page.getByRole('button', { name: '导出整理方案', exact: true }).click();
  await expect(page.locator('.export-result')).toBeVisible();
  const reports = await fs.readdir(path.join(data, 'exports'));
  expect(reports).toHaveLength(1);
  const reportPath = path.join(data, 'exports', reports[0]);
  const text = await fs.readFile(reportPath, 'utf8');
  expect(text).toContain('未执行真实文件操作');
  expect(text).toContain('02_创作素材/封面草稿.png');
  expect(text).not.toContain(base);
  await fs.copyFile(reportPath, '03_测试结果/演示整理方案.md');
  expect(await fingerprint(root)).toEqual(before);
  pass('真实结构推导前后对照；导出包含逐项路径与未执行声明；源路径/大小/mtime/SHA256 均不变');
  await page.getByRole('button', { name: '返回继续整理' }).click();
  if (await page.getByRole('button', { name: '关闭提示', exact: true }).isVisible())
    await page.getByRole('button', { name: '关闭提示', exact: true }).click();
  await page.screenshot({ path: '03_测试结果/demo-workspace.png' });
  await page.setViewportSize({ width: 1000, height: 680 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '03_测试结果/demo-compact.png' });
  // Simulate a hostile junction only inside this test's private temporary data.
  const outside = path.join(base, '边界外测试目录');
  await fs.mkdir(outside);
  for (const folder of ['exports', 'demo-runs']) {
    const original = path.join(data, folder),
      backup = path.join(data, `${folder}-backup`);
    await fs.rename(original, backup);
    await fs.symlink(outside, original, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const result =
        folder === 'exports'
          ? await page.evaluate((p) => window.fileCanvas.exportPlan(p), adopted)
          : await page.evaluate(() => window.fileCanvas.openDemo());
      expect(result.ok).toBe(false);
      expect(result.error).toContain('符号链接');
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.unlink(original);
      await fs.rename(backup, original);
    }
  }
  pass('导出目录和演示目录被替换为目录联接时拒绝写入，边界外测试目录保持为空');
  await page.getByLabel('更多工具').click();
  await page.getByRole('button', { name: '体验示例', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('20 个文件 · 2 个文件夹');
  const secondRecords = await page.evaluate(() => window.fileCanvas.projects());
  expect(secondRecords.data).toHaveLength(2);
  expect(secondRecords.data.find((p) => p.id !== first.id).rootPath).not.toBe(root);
  expect(JSON.parse(await fs.readFile(projectFile, 'utf8')).nodes).toEqual(adopted.nodes);
  expect(await fingerprint(root)).toEqual(before);
  pass('再次体验创建新副本，保留上一份演示与进度；1000×680 无页面溢出');
  expect(errors).toEqual([]);
  await fs.writeFile(
    '03_测试结果/demo-acceptance.json',
    JSON.stringify({ status: 'passed', base, root, assertions, errors }, null, 2),
    'utf8',
  );
} catch (error) {
  if (app)
    try {
      await (await app.firstWindow()).screenshot({ path: '03_测试结果/demo-failure.png' });
    } catch {}
  await fs.writeFile(
    '03_测试结果/demo-acceptance.json',
    JSON.stringify({ status: 'failed', base, assertions, errors, error: String(error) }, null, 2),
    'utf8',
  );
  throw error;
} finally {
  if (app) await app.close();
}
