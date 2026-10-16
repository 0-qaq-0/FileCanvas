import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-'));
const root = path.join(base, '原始测试文件');
const data = path.join(base, '应用数据');
await fs.mkdir(root);
await fs.mkdir(data);
await fs.mkdir(path.join(root, '子目录'));
await fs.mkdir(path.join(root, '其他目录'));
const files = [
  'A.jpg',
  'B.jpg',
  '报告.docx',
  '视频.mp4',
  '音频.mp3',
  '笔记.txt',
  '表格.xlsx',
  '归档.zip',
  '子目录/代码.py',
  '其他目录/记录.md',
];
for (const [i, name] of files.entries())
  await fs.writeFile(path.join(root, name), `filecanvas-acceptance-${i}`, 'utf8');
async function fingerprint() {
  const result = {};
  async function walk(folder) {
    for (const e of await fs.readdir(folder, { withFileTypes: true })) {
      const p = path.join(folder, e.name);
      const stat = await fs.stat(p);
      result[path.relative(root, p)] = e.isDirectory()
        ? 'folder'
        : `${stat.size}:${stat.mtimeMs}:${createHash('sha256')
            .update(await fs.readFile(p))
            .digest('hex')}`;
      if (e.isDirectory()) await walk(p);
    }
  }
  await walk(root);
  return result;
}
const before = await fingerprint();
const errors = [];
let desktop;
const env = {
  ...process.env,
  FILECANVAS_E2E: '1',
  FILECANVAS_TEST_ROOT: root,
  FILECANVAS_TEST_DATA: data,
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = async () => {
  const instance = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await instance.firstWindow();
  page.on('pageerror', (err) => errors.push(err.message));
  await page.waitForLoadState('domcontentloaded');
  return [instance, page];
};
await fs.mkdir('03_测试结果', { recursive: true });
const report = {
  base,
  root,
  assertions: [],
  stage: '阶段一：只读虚拟整理',
  permissionTest: 'EPERM/EACCES 单元测试模拟，不声称已覆盖所有真实 ACL 环境',
};
function pass(message) {
  report.assertions.push(message);
  console.log(`PASS ${message}`);
}
try {
  let page;
  [desktop, page] = await launch();
  await page.getByRole('button', { name: '选择文件夹，开始整理' }).click();
  await page.getByRole('button', { name: '文件栏', exact: true }).click();
  await expect(page.getByTestId('source-row')).toHaveCount(10);
  await page.keyboard.press('Control+a');
  await page.getByRole('button', { name: '移出画布', exact: true }).click();
  const sandbox = await page.evaluate(() => ({
    node: typeof window.require,
    bridge: Object.keys(window.fileCanvas),
  }));
  expect(sandbox.node).toBe('undefined');
  expect(sandbox.bridge).not.toContain('move');
  await page.getByLabel('更多工具').click();
  await expect(page.getByRole('button', { name: /应用到硬盘/ })).toBeDisabled();
  await page.getByLabel('更多工具').click();
  pass('Electron 正常启动；渲染进程无 require；真实应用按钮禁用');
  const source = (name) => page.locator(`[data-testid="source-row"][data-name="${name}"]`);
  const card = (name) => page.locator(`[data-testid="canvas-card"][data-name="${name}"]`);
  const canvas = page.getByTestId('canvas');
  await source('子目录').getByRole('button', { name: '展开或折叠' }).click();
  await expect(source('代码.py')).toBeVisible();
  await source('子目录').getByRole('button', { name: '展开或折叠' }).click();
  await expect(source('代码.py')).toHaveCount(0);
  await source('A.jpg').dragTo(canvas, { targetPosition: { x: 40, y: 40 } });
  await expect(card('A.jpg')).toBeVisible();
  await source('B.jpg').dragTo(canvas, { targetPosition: { x: 215, y: 40 } });
  await expect(page.getByTestId('canvas-card')).toHaveCount(2);
  await source('A.jpg').dragTo(canvas, { targetPosition: { x: 40, y: 40 } });
  await expect(page.getByTestId('canvas-card')).toHaveCount(2);
  pass('真实左侧拖入画布与重复拖入去重通过');
  async function coordinates(name) {
    return card(name).evaluate((e) => ({ x: parseInt(e.style.left), y: parseInt(e.style.top) }));
  }
  const a0 = await coordinates('A.jpg'),
    b0 = await coordinates('B.jpg');
  // Box selection hits both cards, then pointer drag moves the selection as one group.
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + 18, bounds.y + 18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + b0.x + 140, bounds.y + 185, { steps: 12 });
  await page.mouse.up();
  await expect(card('A.jpg')).toHaveAttribute('aria-pressed', 'true');
  await expect(card('B.jpg')).toHaveAttribute('aria-pressed', 'true');
  const aBox = await card('A.jpg').boundingBox();
  await page.mouse.move(aBox.x + 60, aBox.y + 60);
  await page.mouse.down();
  await page.mouse.move(aBox.x + 100, aBox.y + 170, { steps: 15 });
  await page.mouse.up();
  const a1 = await coordinates('A.jpg'),
    b1 = await coordinates('B.jpg');
  expect(Math.abs(a1.y - a0.y - 110)).toBeLessThanOrEqual(2);
  expect(b1.y - b0.y).toBe(a1.y - a0.y);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await coordinates('A.jpg')).y).toBe(a0.y);
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await coordinates('A.jpg')).y).toBe(a1.y);
  pass('B：框选、批量自由拖动和 Ctrl+Z / Ctrl+Y 通过');
  await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('图片');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(card('图片')).toBeVisible();
  await page.keyboard.press('Escape');
  // Real pointer drag into a folder, not a DOM-only invocation of the model.
  const from = await card('A.jpg').boundingBox(),
    to = await card('图片').boundingBox();
  await page.mouse.move(from.x + 60, from.y + 60);
  await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + 60, { steps: 20 });
  await page.mouse.up();
  await expect(card('A.jpg')).toHaveCount(0);
  await card('图片').dblclick();
  await expect(card('A.jpg')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    const r = await card('A.jpg').boundingBox();
    await page.mouse.move(r.x + 60, r.y + 65);
    await page.mouse.down();
    await page.mouse.move(r.x + 72, r.y + 72, { steps: 3 });
    await page.mouse.up();
  }
  const inside = await coordinates('A.jpg');
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  expect(await coordinates('B.jpg')).toEqual(b1);
  await card('图片').dblclick();
  expect(await coordinates('A.jpg')).toEqual(inside);
  await page.getByRole('button', { name: /预览变更/ }).click();
  const preview = page.getByRole('dialog', { name: '预览整理结果' });
  await expect(preview).toContainText(path.join(root, 'A.jpg'));
  await expect(preview).toContainText(path.join(root, '图片', 'A.jpg'));
  expect(await fingerprint()).toEqual(before);
  await page.screenshot({ path: '03_测试结果/preview.png' });
  await page.getByRole('button', { name: '返回继续整理' }).click();
  pass('B/C：连续拖动、文件夹导航保留坐标；A.jpg 目标路径正确，真实文件未改变');
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  // Import the rest of the fixture using the multi-select browser action.
  for (const name of [
    '报告.docx',
    '视频.mp4',
    '音频.mp3',
    '笔记.txt',
    '表格.xlsx',
    '归档.zip',
    '子目录',
    '其他目录',
  ])
    await page.getByRole('checkbox', { name: `选择 ${name}`, exact: true }).check();
  await page.getByRole('button', { name: '加入画布', exact: true }).click();
  await expect(page.locator('.statusbar')).toContainText('10 个文件');
  await page.getByRole('textbox', { name: '搜索原始文件' }).fill('代码');
  await expect(source('代码.py')).toBeVisible();
  await page.getByRole('button', { name: '清空搜索' }).click();
  await page.getByRole('textbox', { name: '搜索原始文件' }).fill('');
  await card('B.jpg').click();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('报告.docx');
  await page.getByRole('button', { name: '确认重命名' }).click();
  await expect(page.getByRole('alert')).toContainText('已存在');
  await page.getByRole('textbox', { name: '名称', exact: true }).fill('../非法');
  await page.getByRole('button', { name: '确认重命名' }).click();
  await expect(page.getByRole('alert')).toContainText('不合法');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  // Cycle rejection through the actual UI, including a failed move into itself.
  await card('图片').click();
  await page.getByRole('button', { name: '移动到…', exact: true }).click();
  await page
    .getByRole('dialog', { name: '移动到虚拟文件夹' })
    .getByRole('button', { name: '图片', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('自己');
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
  pass('D：界面拒绝重名、非法路径与循环层级；跨子目录搜索通过');
  await page.getByLabel('更多工具').click();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: '03_测试结果/workspace.png' });
  const storedFiles = (await fs.readdir(path.join(data, 'projects'))).filter((n) =>
    n.endsWith('.json'),
  );
  expect(storedFiles.length).toBe(1);
  const savedProject = JSON.parse(
    await fs.readFile(path.join(data, 'projects', storedFiles[0]), 'utf8'),
  );
  expect(Object.values(savedProject.nodes).filter((n) => n.kind === 'file')).toHaveLength(10);
  await desktop.close();
  desktop = null;
  [desktop, page] = await launch();
  await expect(page.locator('.statusbar')).toContainText('10 个文件');
  expect(await coordinates('B.jpg')).toEqual(b1);
  await card('图片').dblclick();
  expect(await coordinates('A.jpg')).toEqual(inside);
  expect(await fingerprint()).toEqual(before);
  pass(
    'A：关闭并重开真实 Electron 后，10 文件项目、嵌套结构与坐标全部恢复；源文件路径/大小/mtime/SHA256 不变',
  );
  // These fixture modifications deliberately model changes made outside FileCanvas.
  await fs.mkdir(path.join(root, '图片'));
  await fs.writeFile(path.join(root, '图片', 'A.jpg'), 'external collision');
  await page.getByRole('button', { name: /预览变更/ }).click();
  await expect(page.getByRole('dialog', { name: '预览整理结果' })).toContainText('目标已存在');
  await page.getByRole('button', { name: '返回继续整理' }).click();
  await fs.unlink(path.join(root, 'A.jpg'));
  await page.getByRole('button', { name: /预览变更/ }).click();
  await expect(page.getByRole('dialog', { name: '预览整理结果' })).toContainText('源文件不可用');
  await page.getByRole('button', { name: '返回继续整理' }).click();
  pass('D：预览重新检查外部目标冲突与被删除的源文件');
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.screenshot({ path: '03_测试结果/compact.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
  report.status = 'passed';
  report.rendererErrors = errors;
  await fs.writeFile('03_测试结果/acceptance.json', JSON.stringify(report, null, 2), 'utf8');
  console.log(`Acceptance passed. Isolated fixture retained: ${base}`);
} catch (error) {
  report.status = 'failed';
  report.error = String(error);
  report.rendererErrors = errors;
  if (desktop) {
    try {
      await (await desktop.firstWindow()).screenshot({ path: '03_测试结果/failure.png' });
    } catch {}
  }
  await fs.writeFile('03_测试结果/acceptance.json', JSON.stringify(report, null, 2), 'utf8');
  throw error;
} finally {
  if (desktop) await desktop.close();
}
