import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

// New-user tutorial: an inline offer on the welcome screen (never an overlay on a fresh
// profile), a five-step spotlight tour on the real controls, keyboard control, replay from
// the menu and from the help dialog, and a promise that the tour never touches real files.
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-tutorial-'));
const data = path.join(base, '应用数据');
await fs.mkdir(data);
const env = { ...process.env, FILECANVAS_E2E: '1', FILECANVAS_TEST_DATA: data };
delete env.ELECTRON_RUN_AS_NODE;
const assertions = [];
const errors = [];
let app;
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
const shots = '03_测试结果/新手教程';
await fs.mkdir(shots, { recursive: true });
const FLAG = 'filecanvas.tutorial.v1';
const STEPS = [
  { title: '这是你的整理画布', target: '.canvas-scroll' },
  { title: '随时看一眼：文件动了没有', target: '[data-tour="notice"]' },
  { title: '不想一个个拖？先出一份草案', target: '[data-tour="draft"]' },
  { title: '满意了，再检查并应用', target: '[data-tour="apply"]' },
  { title: '反悔也有办法', target: '[data-tour="more"]' },
];
try {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  const tour = page.getByRole('dialog', { name: '新手教程' });
  const count = () => page.locator('.tour-count');
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  // 1. A fresh profile gets an inline offer, never an overlay that blocks the first click.
  await expect(page.getByRole('button', { name: '选择文件夹，开始整理' })).toBeVisible();
  await expect(page.getByText('第一次用？花 1 分钟看懂')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重新看新手教程' })).toHaveCount(0);
  await page.screenshot({ path: `${shots}/01-欢迎页.png` });
  pass('新环境的欢迎页只给出“开始新手教程”入口，没有任何遮罩弹出');

  // 2. Once the tutorial is done the welcome screen shrinks the offer to a replay link.
  await page.evaluate((flag) => localStorage.setItem(flag, 'done'), FLAG);
  await page.reload();
  await expect(page.getByRole('button', { name: '重新看新手教程' })).toBeVisible();
  await expect(page.getByText('第一次用？花 1 分钟看懂')).toHaveCount(0);
  await page.evaluate((flag) => localStorage.removeItem(flag), FLAG);
  await page.reload();
  await expect(page.getByText('第一次用？花 1 分钟看懂')).toBeVisible();
  pass('看过教程后欢迎页改为“重新看新手教程”，清除标记后恢复提示');

  // 3. Starting from the welcome screen opens the demo copy first, quietly, then the tour.
  await page.getByRole('button', { name: '开始新手教程' }).click();
  await expect(tour).toBeVisible();
  await expect(page.locator('.statusbar')).toContainText('20 个文件');
  await expect(page.getByRole('status')).toHaveCount(0);
  const records = (await page.evaluate(() => window.fileCanvas.projects())).data;
  expect(records).toHaveLength(1);
  const root = records[0].rootPath;
  const before = await fingerprint(root);
  await expect(count()).toHaveText('第 1 步 / 共 5 步');
  pass('教程自动打开 20 文件示例副本并从第 1 步开始，不弹额外提示');

  // 4. Every step lights up the real control it talks about and keeps the card on screen.
  async function checkStep(index, viewport) {
    const { title, target } = STEPS[index];
    await expect(tour.getByRole('heading', { name: title })).toBeVisible();
    await expect(count()).toHaveText(`第 ${index + 1} 步 / 共 5 步`);
    await page.waitForTimeout(400); // spotlight and card glide to their new place
    const geometry = await page.evaluate((selector) => {
      const t = document.querySelector(selector).getBoundingClientRect();
      const s = document.querySelector('.tour-spot').getBoundingClientRect();
      const c = document.querySelector('.tour-card').getBoundingClientRect();
      return { t, s, c };
    }, target);
    const slack = 1;
    expect(geometry.s.left).toBeLessThanOrEqual(geometry.t.left + slack);
    expect(geometry.s.top).toBeLessThanOrEqual(geometry.t.top + slack);
    expect(geometry.s.right).toBeGreaterThanOrEqual(
      Math.min(geometry.t.right, viewport.width) - slack,
    );
    expect(geometry.s.bottom).toBeGreaterThanOrEqual(
      Math.min(geometry.t.bottom, viewport.height) - slack,
    );
    expect(geometry.c.left).toBeGreaterThanOrEqual(15);
    expect(geometry.c.top).toBeGreaterThanOrEqual(15);
    expect(geometry.c.right).toBeLessThanOrEqual(viewport.width - 15);
    expect(geometry.c.bottom).toBeLessThanOrEqual(viewport.height - 15);
    expect(await noOverflow()).toBe(true);
  }
  await checkStep(0, { width: 1280, height: 800 });
  await page.screenshot({ path: `${shots}/02-第1步-画布.png` });

  // 5. Keyboard drives the tour and the canvas shortcuts stay quiet behind it.
  await page.keyboard.press('Control+a');
  await expect(page.locator('.selection-toolbar')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await checkStep(1, { width: 1280, height: 800 });
  await page.screenshot({ path: `${shots}/03-第2步-状态条.png` });
  await tour.getByRole('button', { name: '下一步' }).click();
  await checkStep(2, { width: 1280, height: 800 });
  await page.screenshot({ path: `${shots}/04-第3步-草案.png` });
  await page.keyboard.press('ArrowRight');
  await checkStep(3, { width: 1280, height: 800 });
  await page.keyboard.press('ArrowLeft');
  await checkStep(2, { width: 1280, height: 800 });
  await tour.getByRole('button', { name: '上一步' }).click();
  await checkStep(1, { width: 1280, height: 800 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await checkStep(4, { width: 1280, height: 800 });
  await page.screenshot({ path: `${shots}/05-第5步-恢复.png` });
  await expect(tour.getByRole('button', { name: '下一步' })).toHaveCount(0);
  pass('五步都高亮真实控件、提示卡不出窗口；←/→/按钮切换，Ctrl+A 等画布快捷键不会穿透');

  // 6. Finishing remembers the flag and leaves the workspace untouched.
  await tour.getByRole('button', { name: '开始整理' }).click();
  await expect(tour).toHaveCount(0);
  expect(await page.evaluate((flag) => localStorage.getItem(flag), FLAG)).toBe('done');
  await expect(page.locator('.statusbar')).toContainText('0 项待变更');
  expect(await fingerprint(root)).toEqual(before);
  pass('完成后记住“已看过”；真实文件的路径、大小、时间与摘要均未变化');

  // 7. Reloading restores the project and does not start the tour by itself.
  await page.reload();
  await expect(page.locator('.statusbar')).toContainText('20 个文件');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  pass('重新打开软件不会自动再弹教程');

  // 8. Replay from the tools menu runs on the current project; Esc and the close button skip.
  await page.getByLabel('更多工具').click();
  await page.getByRole('button', { name: '新手教程', exact: true }).click();
  await expect(tour).toBeVisible();
  await expect(count()).toHaveText('第 1 步 / 共 5 步');
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  expect((await page.evaluate(() => window.fileCanvas.projects())).data).toHaveLength(1);
  await page.getByLabel('更多工具').click();
  await page.getByRole('button', { name: '新手教程', exact: true }).click();
  await tour.getByRole('button', { name: '关闭教程' }).click();
  await expect(tour).toHaveCount(0);
  pass('更多工具 → 新手教程可随时重看，用当前项目而不新建副本；Esc 与关闭按钮都能退出');

  // 9. The help dialog points at the tutorial.
  await page.getByLabel('更多工具').click();
  await page.getByRole('button', { name: '使用说明' }).click();
  await page.getByRole('button', { name: /跟着 5 步新手教程走一遍/ }).click();
  await expect(page.getByRole('dialog', { name: '先虚拟整理，再核对结果' })).toHaveCount(0);
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: '跳过教程' }).click();
  await expect(tour).toHaveCount(0);
  pass('使用说明里的入口可直接开始教程，并关闭说明');

  // 10. Narrow window: the card never leaves the window and nothing overflows.
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.getByLabel('更多工具').click();
  await page.getByRole('button', { name: '新手教程', exact: true }).click();
  for (let i = 0; i < STEPS.length; i++) {
    await checkStep(i, { width: 1000, height: 680 });
    if (i === 2) await page.screenshot({ path: `${shots}/06-窄窗口-第3步.png` });
    if (i < STEPS.length - 1) await page.keyboard.press('ArrowRight');
  }
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  pass('1000×680 窄窗口下五步的高亮和提示卡都在窗口内，页面无横向溢出');

  // 11. However often it was run, the tutorial never touched the real files.
  expect(await fingerprint(root)).toEqual(before);
  pass('教程全程不改动真实文件');
  expect(errors).toEqual([]);
  await fs.writeFile(
    '03_测试结果/tutorial-acceptance.json',
    JSON.stringify({ status: 'passed', base, assertions, errors }, null, 2),
    'utf8',
  );
} catch (error) {
  if (app)
    try {
      await (await app.firstWindow()).screenshot({ path: `${shots}/zz-failure.png` });
    } catch {}
  await fs.writeFile(
    '03_测试结果/tutorial-acceptance.json',
    JSON.stringify({ status: 'failed', base, assertions, errors, error: String(error) }, null, 2),
    'utf8',
  );
  throw error;
} finally {
  if (app) await app.close();
}
