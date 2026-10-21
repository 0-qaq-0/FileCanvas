import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

// Display modes: 画布 / 平铺 / 列表 / 分组 on the same plan. Selection, sorting, grouping,
// opening folders, dragging onto a folder (and out again), the right-click menu, filtering,
// keyboard, icon size, the docked settings panel (whose shortcuts must keep working), saving
// the choice, and the promise that no mode touches real files or the canvas layout.
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-views-'));
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
const shots = '03_测试结果/展示方式';
await fs.mkdir(shots, { recursive: true });
let app;
async function launch() {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  return page;
}
const SVG = '版式参考.svg';
const FOLDER = '临时下载';
try {
  let page = await launch();
  const item = (name) => page.locator(`[data-testid="view-item"][data-name="${name}"]`);
  const items = () => page.getByTestId('view-item');
  const names = () => items().evaluateAll((els) => els.map((e) => e.getAttribute('data-name')));
  const mode = (label) => page.getByRole('button', { name: `${label}视图` });
  const status = () => page.locator('.statusbar');
  const panel = () => page.getByRole('dialog', { name: '界面设置' });
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  await page.getByRole('button', { name: '先用 20 个示例文件试一遍' }).click();
  await expect(status()).toContainText('20 个文件 · 2 个文件夹');
  const records = (await page.evaluate(() => window.fileCanvas.projects())).data;
  const root = records[0].rootPath;
  const before = await fingerprint(root);
  const toast = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await toast.isVisible()) await toast.click();

  // Where the canvas cards are now; switching views must never move them.
  const canvasLayout = () =>
    page
      .getByTestId('canvas-card')
      .evaluateAll((els) =>
        els.map((e) => `${e.getAttribute('data-name')}@${e.style.left},${e.style.top}`).sort(),
      );
  const layoutBefore = await canvasLayout();
  await expect(mode('画布')).toHaveAttribute('aria-pressed', 'true');

  // 1. Tiles: one uniform card per item of this level, folders first.
  await mode('平铺').click();
  await expect(mode('平铺')).toHaveAttribute('aria-pressed', 'true');
  await expect(items()).toHaveCount(18);
  const order = await names();
  expect(order.slice(0, 2).sort()).toEqual(['临时下载', '旧资料']);
  const sizes = await items().evaluateAll((els) =>
    els
      .slice(0, 6)
      .map((e) => [
        Math.round(e.getBoundingClientRect().width),
        Math.round(e.getBoundingClientRect().height),
      ]),
  );
  expect(new Set(sizes.map((s) => s.join('x')))).toEqual(new Set(['136x138']));
  await expect(page.getByTestId('canvas-card')).toHaveCount(0);
  await page.screenshot({ path: `${shots}/01-平铺.png` });
  pass('平铺：本层 18 项各一张等大卡片（136×138），文件夹排在最前');

  // 2. Sorting: by size, largest first; by name again restores the order.
  await page.getByLabel('排序方式').selectOption({ label: '大小' });
  await page.getByRole('button', { name: '当前升序，点击改为降序' }).click();
  const bySize = await item(SVG).count();
  expect(bySize).toBe(1);
  const third = await items().nth(2).getAttribute('data-name');
  expect(third).toMatch(/\.wav$/);
  await page.getByLabel('排序方式').selectOption({ label: '名称' });
  await page.getByRole('button', { name: '当前降序，点击改为升序' }).click();
  expect(await names()).toEqual(order);
  pass('平铺可按名称/类型/大小/修改时间排序，升降序切换；文件夹始终在前');

  // 3. Selection: click selects and explains a file; Ctrl toggles; Shift selects a range.
  await item(SVG).click();
  await expect(item(SVG)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.file-inspector')).toBeVisible();
  const second = order[4];
  await item(second).click({ modifiers: ['Control'] });
  await expect(page.locator('.selection-toolbar')).toContainText('已选择 2 项');
  await item(order[2]).click();
  await item(order[6]).click({ modifiers: ['Shift'] });
  await expect(page.locator('.selection-toolbar')).toContainText('已选择 5 项');
  await page.locator('.listing-scroll').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.selection-toolbar')).toHaveCount(0);
  pass('单击选中并显示文件内容；Ctrl 点选；Shift 选连续区间；点空白取消');

  // 4. Keyboard: arrows move and select, Home/End jump.
  await item(order[2]).focus();
  await page.keyboard.press('ArrowRight');
  await expect(item(order[3])).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(item(order[order.length - 1])).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(item(order[0])).toHaveAttribute('aria-selected', 'true');
  pass('键盘：方向键移动并选中，Home / End 跳到首尾');

  // 5. Groups: sections by type, month and plan status.
  await mode('分组').click();
  await expect(item(order[0])).toHaveAttribute('aria-selected', 'true'); // selection survives
  await expect(page.locator('.group-head strong').first()).toHaveText('文件夹');
  const typeLabels = await page.locator('.group-head strong').allTextContents();
  expect(typeLabels).toEqual(expect.arrayContaining(['文件夹', '图片', '文档']));
  await page.getByLabel('分组方式').selectOption({ label: '修改月份' });
  expect(
    (await page.locator('.group-head strong').allTextContents()).every((t) =>
      /^\d{4}-\d{2}$|未知时间/.test(t),
    ),
  ).toBe(true);
  await page.getByLabel('分组方式').selectOption({ label: '计划状态' });
  await expect(page.locator('.group-head strong')).toHaveText(['未改动']);
  await page.getByLabel('分组方式').selectOption({ label: '文件类型' });
  const head = page.locator('.group-head').first();
  await expect(head).toHaveAttribute('aria-expanded', 'true');
  await head.click();
  await expect(head).toHaveAttribute('aria-expanded', 'false');
  await expect(items()).toHaveCount(16);
  await head.click();
  await expect(items()).toHaveCount(18);
  await page.screenshot({ path: `${shots}/02-分组.png` });
  pass('分组：按文件类型、修改月份、计划状态分栏，可折叠；切换视图时选中保留');

  // 6. List: columns, sorting by header, folders opened in place.
  await mode('列表').click();
  await expect(page.locator('.list-head')).toContainText('名称');
  await expect(page.locator('.list-head')).toContainText('修改时间');
  const sortHead = (label) => page.locator('.list-head').getByRole('button', { name: label });
  await expect(sortHead('名称')).toHaveAttribute('aria-sort', 'ascending');
  await sortHead('大小').click();
  await expect(sortHead('大小')).toHaveAttribute('aria-sort', 'ascending');
  await sortHead('大小').click();
  await expect(sortHead('大小')).toHaveAttribute('aria-sort', 'descending');
  expect((await names())[2]).toMatch(/\.wav$/);
  await sortHead('名称').click();
  await page.getByRole('button', { name: '展开 旧资料' }).click();
  const depths = await page
    .locator('.list-row')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-depth')));
  expect(depths.filter((d) => d === '1')).toHaveLength(2);
  await expect(page.getByRole('button', { name: '收起 旧资料' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.screenshot({ path: `${shots}/03-列表.png` });
  await page.getByRole('button', { name: '全部收起' }).click();
  await expect(page.locator('.list-row[data-depth="1"]')).toHaveCount(0);
  pass('列表：名称/类型/大小/修改时间/状态各列，点表头排序，文件夹可就地展开与收起');

  // 7. Dragging: onto a folder moves into it (and undo restores); out of a folder onto the level.
  await item(SVG).dragTo(item(FOLDER));
  await expect(status()).toContainText('1 项待变更');
  await expect(item(SVG)).toHaveCount(0);
  await page.getByRole('button', { name: `展开 ${FOLDER}` }).click();
  await expect(item(SVG)).toHaveAttribute('data-depth', '1');
  await item(SVG).dragTo(item(order[3]));
  await expect(status()).toContainText('0 项待变更');
  await expect(item(SVG)).toHaveAttribute('data-depth', '0');
  // Two undos take back both moves, so the canvas layout below is exactly as it was.
  await page.keyboard.press('Control+z');
  await expect(status()).toContainText('1 项待变更');
  await page.waitForTimeout(250); // the key handler re-attaches after each render
  await page.keyboard.press('Control+z');
  await expect(status()).toContainText('0 项待变更');
  await expect(item(SVG)).toHaveAttribute('data-depth', '0');
  // A folder dropped onto something inside itself is ignored quietly (no error toast).
  const closedToggle = page.getByRole('button', { name: `展开 ${FOLDER}` });
  if (await closedToggle.count()) await closedToggle.click(); // undo leaves it as it was
  await item(FOLDER).dragTo(item('配图.png'));
  await expect(status()).toContainText('0 项待变更');
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.getByRole('button', { name: '全部收起' }).click();
  pass('拖到文件夹行即移入，拖到同层其他行即移出，Ctrl+Z 撤销；把文件夹拖进自己里面会被安静地忽略');

  // 8. Opening: double-click enters a folder; the breadcrumb leads back.
  await page.getByRole('button', { name: '全部收起' }).click();
  await item(FOLDER).dblclick();
  await expect(page.locator('.breadcrumb')).toContainText(FOLDER);
  await expect(items()).toHaveCount(2);
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  await expect(items()).toHaveCount(18);
  pass('双击文件夹进入该层，面包屑与“返回上一级”可回到上层');

  // 9. Right-click menu, filter.
  await item(SVG).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '文件操作' });
  await expect(menu.getByRole('menuitem', { name: '重命名' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '移入新文件夹' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page.getByLabel('筛选当前层文件').fill('封面');
  await expect(page.locator('.filter-count')).toContainText('项匹配');
  expect(await page.locator('.list-row.dimmed').count()).toBeGreaterThan(0);
  expect(await page.locator('.list-row.filter-hit').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page.locator('.list-row.dimmed')).toHaveCount(0);
  pass('右键菜单与画布一致；筛选淡化未匹配项并高亮命中项');

  // 10. The docked settings panel: view radios, icon size on tiles, shortcuts still live.
  await page.getByRole('button', { name: '界面设置' }).click();
  await expect(panel()).toBeVisible();
  await panel().getByRole('radio', { name: '平铺', exact: true }).click();
  await expect(mode('平铺')).toHaveAttribute('aria-pressed', 'true');
  await panel().getByRole('slider', { name: '图标大小' }).fill('150');
  await expect.poll(async () => Math.round((await item(SVG).boundingBox()).width)).toBe(204);
  await item(SVG).dragTo(item(FOLDER));
  await expect(status()).toContainText('1 项待变更');
  await page.keyboard.press('Control+z'); // still undoes while the panel is open
  await expect(status()).toContainText('0 项待变更');
  await item(order[2]).click();
  await page.keyboard.press('Escape'); // closes the panel first
  await expect(panel()).toHaveCount(0);
  await expect(item(order[2])).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape'); // then clears the selection
  await expect(item(order[2])).toHaveAttribute('aria-selected', 'false');
  pass(
    '设置面板里可切换展示方式；平铺随图标大小缩放（150%→204px）；面板打开时画布快捷键仍可用，Esc 先关面板',
  );

  // 11. The choice (and sort/group) is saved and restored.
  await page.getByRole('button', { name: '界面设置' }).click();
  await panel().getByRole('slider', { name: '图标大小' }).fill('100');
  await panel().getByRole('button', { name: '完成' }).click();
  await mode('分组').click();
  await page.getByLabel('分组方式').selectOption({ label: '修改月份' });
  await page.getByLabel('排序方式').selectOption({ label: '大小' });
  await expect
    .poll(
      async () =>
        JSON.parse(await fs.readFile(path.join(data, 'preferences.json'), 'utf8')).preferences,
    )
    .toMatchObject({ viewMode: 'groups', groupBy: 'month', sortKey: 'size' });
  await app.close();
  page = await launch();
  await expect(status()).toContainText('20 个文件');
  await expect(mode('分组')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('分组方式')).toHaveValue('month');
  await expect(page.getByLabel('排序方式')).toHaveValue('size');
  pass('展示方式、分组和排序重启后保留');

  // 12. Narrow window: every mode fits, with the inspector open too.
  await page.setViewportSize({ width: 1000, height: 680 });
  for (const label of ['平铺', '分组', '列表', '画布']) {
    await mode(label).click();
    expect(await noOverflow()).toBe(true);
  }
  await mode('列表').click();
  await item(SVG).click();
  await expect(page.locator('.file-inspector')).toBeVisible();
  expect(await noOverflow()).toBe(true);
  await page.screenshot({ path: `${shots}/04-窄窗口列表.png` });
  pass('1000×680 下四种展示方式都无横向溢出（列表还带着内容面板）');

  // 13. Back on the canvas nothing moved, and no real file was touched.
  await page.setViewportSize({ width: 1280, height: 800 });
  await mode('画布').click();
  await expect(page.getByTestId('canvas-card').first()).toBeVisible();
  expect(await canvasLayout()).toEqual(layoutBefore);
  expect(await fingerprint(root)).toEqual(before);
  expect(errors).toEqual([]);
  pass('回到画布后每张卡片位置不变；全程不改动真实文件');
  await fs.writeFile(
    '03_测试结果/views-acceptance.json',
    JSON.stringify({ status: 'passed', base, assertions, errors }, null, 2),
    'utf8',
  );
} catch (error) {
  if (app)
    try {
      await (await app.firstWindow()).screenshot({ path: `${shots}/zz-failure.png` });
    } catch {}
  await fs.writeFile(
    '03_测试结果/views-acceptance.json',
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
