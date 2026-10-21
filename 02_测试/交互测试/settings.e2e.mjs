import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

// Display settings ("界面设置"): icon size (slider, presets, Ctrl+wheel) with dragging still
// landing on the right folder, canvas background, card previews, hint strips, reduced motion;
// live panel, saved in the app data directory, restored on the next start, damaged files kept
// aside, and none of it ever touching real files.
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-settings-'));
const data = path.join(base, '应用数据');
await fs.mkdir(data);
const env = { ...process.env, FILECANVAS_E2E: '1', FILECANVAS_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const assertions = [];
const errors = [];
const pass = (message) => {
  assertions.push(message);
  console.log(`PASS ${message}`);
};
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
const shots = '03_测试结果/界面设置';
await fs.mkdir(shots, { recursive: true });
const prefsFile = path.join(data, 'preferences.json');
const readPrefs = async () => JSON.parse(await fs.readFile(prefsFile, 'utf8'));
let app;
async function launch() {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  return page;
}
const SVG = '版式参考.svg';
try {
  let page = await launch();
  const card = (name) => page.locator(`[data-testid="canvas-card"][data-name="${name}"]`);
  const size = async (name) =>
    card(name).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    });
  const panel = () => page.getByRole('dialog', { name: '界面设置' });
  const slider = () => page.getByRole('slider', { name: '图标大小' });
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  async function openPanel() {
    await page.getByRole('button', { name: '界面设置' }).click();
    await expect(panel()).toBeVisible();
  }
  async function closePanel() {
    await panel().getByRole('button', { name: '完成' }).click();
    await expect(panel()).toHaveCount(0);
  }

  await page.getByRole('button', { name: '先用 20 个示例文件试一遍' }).click();
  await expect(page.locator('.statusbar')).toContainText('20 个文件 · 2 个文件夹');
  const records = (await page.evaluate(() => window.fileCanvas.projects())).data;
  const root = records[0].rootPath;
  const before = await fingerprint(root);
  const toast = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await toast.isVisible()) await toast.click();

  // 1. Defaults, and reading them writes nothing.
  expect(await size(SVG)).toEqual({ w: 136, h: 138 });
  await openPanel();
  await expect(slider()).toHaveValue('100');
  await expect(panel().getByRole('button', { name: '标准', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel().getByRole('button', { name: '恢复默认' })).toBeDisabled();
  await expect(panel().getByRole('radio', { name: '点阵' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(panel().getByRole('switch', { name: '卡片预览' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.screenshot({ path: `${shots}/01-默认.png` });
  await expect(fs.access(prefsFile)).rejects.toThrow();
  pass('默认 100% 标准大小，面板里各项为默认；只读取不会写出设置文件');

  // 2. The slider resizes the cards live; presets and the slider stay in step.
  await slider().fill('150');
  await expect.poll(() => size(SVG)).toEqual({ w: 204, h: 207 });
  await expect(panel().getByRole('button', { name: '特大', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: `${shots}/02-特大图标.png` });
  await panel().getByRole('button', { name: '小', exact: true }).click();
  await expect(slider()).toHaveValue('80');
  const small = await size(SVG);
  expect(small.w).toBeCloseTo(108.8, 0);
  await slider().fill('70');
  await expect.poll(async () => (await size(SVG)).w).toBeCloseTo(95.2, 0);
  const scroll = await page
    .locator('.canvas-scroll')
    .evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
  expect(scroll.sw).toBeLessThanOrEqual(scroll.cw + 1);
  await page.screenshot({ path: `${shots}/03-小图标.png` });
  pass('滑块和“小/标准/大/特大”联动，卡片实时缩放（70%–160%）；缩小时画布不出现多余滚动区');

  // 3. A zoomed canvas still drops files where the pointer is, and undo restores the plan.
  await slider().fill('150');
  await closePanel();
  await page.locator('.canvas-scroll').evaluate((e) => {
    e.scrollTop = 0;
    e.scrollLeft = 0;
  });
  const from = await card(SVG).boundingBox();
  const to = await card('临时下载').boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await expect(page.locator('.drop-destination')).toContainText('放入：临时下载');
  await page.mouse.up();
  await expect(card(SVG)).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('1 项待变更');
  await page.keyboard.press('Control+z');
  await expect(card(SVG)).toHaveCount(1);
  await expect(page.locator('.statusbar')).toContainText('0 项待变更');
  pass('150% 下拖进文件夹落点准确（提示“放入：临时下载”），撤销后计划与真实文件均未变');

  // 4. Ctrl + wheel changes the size like a file manager, in 5% steps.
  await page.keyboard.press('Control+,');
  await expect(panel()).toBeVisible();
  await panel().getByRole('button', { name: '恢复默认' }).click();
  await closePanel();
  await expect.poll(() => size(SVG)).toEqual({ w: 136, h: 138 });
  const area = await page.locator('.canvas-scroll').boundingBox();
  await page.mouse.move(area.x + 300, area.y + 200);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await size(SVG)).w).toBeCloseTo(149.6, 0);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 120);
  await page.keyboard.up('Control');
  await expect.poll(() => size(SVG)).toEqual({ w: 136, h: 138 });
  pass('Ctrl+, 打开设置并可“恢复默认”；Ctrl+滚轮每格 ±5%，滚回 100% 时尺寸精确还原');

  // 5. Background, previews, hint strips and motion.
  await openPanel();
  await expect(page.getByTestId('suggestion-bar')).toBeVisible();
  await expect(page.locator('.canvas-hint')).toBeVisible();
  expect(await page.locator('.card-thumbnail').count()).toBeGreaterThan(0);
  await panel().getByRole('radio', { name: '网格' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/bg-grid/);
  await panel().getByRole('radio', { name: '纯色' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/bg-plain/);
  await expect(page.locator('.canvas-surface')).toHaveCSS('background-image', 'none');
  await panel().getByRole('switch', { name: '卡片预览' }).click();
  await expect(page.locator('.card-thumbnail')).toHaveCount(0);
  await expect(page.locator('.card-document')).toHaveCount(0);
  await panel().getByRole('switch', { name: '整理建议条' }).click();
  await expect(page.getByTestId('suggestion-bar')).toHaveCount(0);
  await panel().getByRole('switch', { name: '底部操作提示' }).click();
  await expect(page.locator('.canvas-hint')).toBeHidden();
  await panel().getByRole('switch', { name: '减少动画' }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/reduce-motion/);
  await page.screenshot({ path: `${shots}/04-纯色无预览.png` });
  await panel().getByRole('switch', { name: '卡片预览' }).click();
  await expect.poll(() => page.locator('.card-thumbnail').count()).toBeGreaterThan(0);
  pass('背景（点阵/网格/纯色）、卡片预览、整理建议条、底部提示、减少动画逐项生效，预览可重新打开');

  // 6. Settings are saved in the app data directory and survive a restart; closing the
  //    window right after a change still saves it.
  await panel().getByRole('radio', { name: '网格' }).click();
  await slider().fill('125');
  await panel().getByRole('switch', { name: '卡片预览' }).click();
  await expect.poll(async () => (await readPrefs()).preferences.iconScale).toBe(1.25);
  const saved = await readPrefs();
  expect(saved).toEqual({
    version: 1,
    preferences: {
      viewMode: 'canvas',
      sortKey: 'name',
      sortDir: 'asc',
      groupBy: 'type',
      iconScale: 1.25,
      background: 'grid',
      showPreviews: false,
      showHints: false,
      showSuggestions: false,
      reduceMotion: true,
      snapToGrid: false,
    },
  });
  await slider().fill('110');
  await app.close(); // no waiting: the close handshake has to flush the pending save
  expect((await readPrefs()).preferences.iconScale).toBe(1.1);
  page = await launch();
  await expect(page.locator('.statusbar')).toContainText('20 个文件');
  await expect.poll(async () => (await size(SVG)).w).toBeCloseTo(149.6, 0);
  await expect(page.locator('.app-shell')).toHaveClass(/bg-grid/);
  await expect(page.locator('.app-shell')).toHaveClass(/reduce-motion/);
  await expect(page.locator('.card-thumbnail')).toHaveCount(0);
  await expect(page.getByTestId('suggestion-bar')).toHaveCount(0);
  await expect(page.locator('.canvas-hint')).toBeHidden();
  await page.screenshot({ path: `${shots}/05-重启后保留.png` });
  pass('设置存为应用数据目录里的 preferences.json；改完立刻关窗也已保存；重启后原样恢复');

  // 7. A narrow window keeps the panel inside it and the page free of horizontal overflow.
  await page.setViewportSize({ width: 1000, height: 680 });
  await openPanel();
  await slider().fill('160');
  const box = await panel().boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(1000);
  expect(box.y + box.height).toBeLessThanOrEqual(680);
  expect(await noOverflow()).toBe(true);
  await page.screenshot({ path: `${shots}/06-窄窗口.png` });
  await page.keyboard.press('Escape');
  await expect(panel()).toHaveCount(0);
  pass('1000×680 下面板完整在窗口内，160% 时页面无横向溢出；Esc 关闭');

  // 8. Reset restores every default and saves them.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openPanel();
  await panel().getByRole('button', { name: '恢复默认' }).click();
  await expect(slider()).toHaveValue('100');
  await expect(panel().getByRole('radio', { name: '点阵' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('suggestion-bar')).toBeVisible();
  await expect(page.locator('.canvas-hint')).toBeVisible();
  await expect(page.locator('.app-shell')).not.toHaveClass(/reduce-motion/);
  await expect.poll(async () => (await readPrefs()).preferences.iconScale).toBe(1);
  await closePanel();
  pass('恢复默认后所有项回到初始值并写入文件');

  // 9. A damaged settings file is kept aside, defaults are used and the user is told.
  await app.close();
  await fs.writeFile(prefsFile, '{ not json', 'utf8');
  page = await launch();
  await expect(page.getByRole('status')).toContainText('显示设置文件无法使用');
  await expect(page.locator('.app-shell')).toHaveClass(/bg-dots/);
  const kept = (await fs.readdir(data)).filter((n) => n.startsWith('preferences.damaged-'));
  expect(kept).toHaveLength(1);
  expect(await fs.readFile(path.join(data, kept[0]), 'utf8')).toBe('{ not json');
  pass('损坏的设置文件改名保留，界面使用默认值并给出提示');

  // 10. However much was changed, no real file was touched.
  expect(await fingerprint(root)).toEqual(before);
  expect(errors).toEqual([]);
  pass('全程不改动真实文件（路径、大小、时间与摘要）');
  await fs.writeFile(
    '03_测试结果/settings-acceptance.json',
    JSON.stringify({ status: 'passed', base, assertions, errors }, null, 2),
    'utf8',
  );
} catch (error) {
  if (app)
    try {
      await (await app.firstWindow()).screenshot({ path: `${shots}/zz-failure.png` });
    } catch {}
  await fs.writeFile(
    '03_测试结果/settings-acceptance.json',
    JSON.stringify({ status: 'failed', base, assertions, errors, error: String(error) }, null, 2),
    'utf8',
  );
  throw error;
} finally {
  if (app)
    try {
      await app.close();
    } catch {}
}
