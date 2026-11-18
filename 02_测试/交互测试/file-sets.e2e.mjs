import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

// File sets: record files without moving them, put one file in several sets, then hand a set out
// as a ZIP or a copied folder, or collect it into a planned folder. Files renamed elsewhere are
// marked and skipped instead of breaking the export.
const shots = path.resolve('03_测试结果/文件集');
await fs.mkdir(shots, { recursive: true });
const base = await fs.mkdtemp(path.join(shots, 'filecanvas-e2e-'));
const root = path.join(base, '示例文件'),
  data = path.join(base, '应用数据'),
  exports = path.join(base, '导出');
await fs.mkdir(path.join(root, '旧资料'), { recursive: true });
await fs.mkdir(data);
await fs.mkdir(exports);
const fixtures = {
  '封面.png': '封面',
  '说明.md': '# 说明',
  '报价.xlsx': '报价',
  '旧资料/封面.png': '旧封面',
};
for (const [name, contents] of Object.entries(fixtures))
  await fs.writeFile(path.join(root, name), contents);
const env = {
  ...process.env,
  TEMP: shots,
  TMP: shots,
  FILECANVAS_E2E: '1',
  FILECANVAS_TEST_DATA: data,
  FILECANVAS_TEST_ROOT: root,
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const pass = (message) => console.log(`PASS ${message}`);
function unzipNames(bytes) {
  const footer = bytes.length - 22;
  const count = bytes.readUInt16LE(footer + 10);
  let offset = bytes.readUInt32LE(footer + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const size = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const local = bytes.readUInt32LE(offset + 42);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    files[bytes.toString('utf8', offset + 46, offset + 46 + nameLength)] = inflateRawSync(
      bytes.subarray(start, start + size),
    ).toString('utf8');
    offset += 46 + nameLength + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
  return files;
}
let app, page;
try {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  const card = (name) => page.locator(`[data-testid="canvas-card"][data-name="${name}"]`);
  const fileMenu = () => page.getByRole('menu', { name: '文件操作', exact: true });
  const setMenu = () => page.getByRole('menu', { name: '文件集操作', exact: true });
  const strip = page.getByRole('region', { name: '文件集' });
  const toast = page.locator('.toast');
  const clearToast = async () => {
    const close = page.getByRole('button', { name: '关闭提示', exact: true });
    if (await close.isVisible()) await close.click();
  };
  const fromMenu = async (name, label) => {
    await card(name).click({ button: 'right' });
    await fileMenu().getByRole('menuitem', { name: label, exact: true }).click();
  };
  const setAction = async (set, label) => {
    await page.getByRole('button', { name: `${set} 的操作`, exact: true }).click();
    await setMenu().getByRole('menuitem', { name: label }).click();
  };

  await page.getByRole('button', { name: '选择文件夹，开始整理' }).click();
  await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
  await expect(page.locator('.apply-entry')).not.toHaveClass(/primary/);
  pass('没有待应用的修改时，“预览并应用”不是醒目的主按钮');

  // A set is created from the file menu, apart from the moves, and its dialog says what it is.
  await card('封面.png').click({ button: 'right' });
  const menuText = await fileMenu().innerText();
  expect(menuText.indexOf('加入新文件集…')).toBeGreaterThan(menuText.indexOf('重命名'));
  await fileMenu().getByRole('menuitem', { name: '加入新文件集…' }).click();
  const dialog = page.getByRole('dialog', { name: '新建文件集' });
  await expect(dialog).toContainText('原文件留在原处');
  await dialog.getByRole('textbox').fill('发给老师');
  await dialog.getByRole('button', { name: '创建文件集', exact: true }).click();
  await expect(strip.getByRole('region', { name: '发给老师' })).toContainText('封面.png');
  await fromMenu('说明.md', '加入“发给老师”');
  await expect(toast).toContainText('文件留在原处');
  await clearToast();
  await card('说明.md').click({ button: 'right' });
  await expect(fileMenu().getByRole('menuitem', { name: '加入“发给老师”' })).toBeDisabled();
  await page.keyboard.press('Escape');
  pass('文件菜单里新建文件集、加入已有文件集；已在其中时不可重复加入');

  // The same file in a second set, by dragging; the hint says nothing will move.
  await fromMenu('报价.xlsx', '新建文件集…');
  await page.getByRole('dialog').getByRole('textbox').fill('报销');
  await page.getByRole('dialog').getByRole('button', { name: '创建文件集' }).click();
  await clearToast();
  const source = await card('封面.png').boundingBox();
  const target = await strip.getByRole('region', { name: '报销' }).boundingBox();
  await page.mouse.move(source.x + 50, source.y + 50);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await expect(page.locator('.drop-destination')).toContainText('加入文件集：报销（不移动文件）');
  await page.screenshot({ path: path.join(shots, '01-拖入文件集.png') });
  await page.mouse.up();
  await expect(card('封面.png').locator('.file-set-badge')).toHaveText('2');
  await expect(card('封面.png').locator('.file-set-badge')).toHaveAttribute(
    'title',
    '文件集：发给老师、报销',
  );
  await expect(page.locator('.statusbar')).toContainText('0 项待变更');
  pass('同一文件拖进第二个文件集，卡片显示所在文件集，计划没有变化');

  // A drop that would be refused says so before the mouse is released.
  const folder = await card('旧资料').boundingBox();
  await page.mouse.move(source.x + 50, source.y + 50);
  await page.mouse.down();
  await page.mouse.move(folder.x + folder.width / 2, folder.y + folder.height / 2, { steps: 12 });
  await expect(page.locator('.drop-destination')).toHaveClass(/drop-blocked/);
  await expect(page.locator('.drop-destination')).toContainText('已有同名的“封面.png”');
  // Holding still keeps saying so: the folder does not spring open under the pointer.
  await page.waitForTimeout(1200);
  await expect(page.locator('.drop-destination')).toHaveClass(/drop-blocked/);
  await expect(card('旧资料')).not.toHaveAttribute('data-expanded', 'true');
  await page.mouse.move(source.x + 50, source.y + 50, { steps: 6 });
  await page.mouse.up();
  pass('拖到有同名文件的文件夹上时，提示在松手前就说明无法放入');

  // ZIP and copy, with the system dialogs answered by the test.
  const zip = path.join(exports, '发给老师.zip');
  await app.evaluate(
    ({ dialog }, paths) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.zip });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.exports] });
    },
    { zip, exports },
  );
  await setAction('发给老师', '打包为 ZIP…');
  await expect(toast).toContainText('压缩包已保存到');
  expect(unzipNames(await fs.readFile(zip))).toEqual({ '封面.png': '封面', '说明.md': '# 说明' });
  await clearToast();
  await setAction('发给老师', '复制到文件夹…');
  await expect(toast).toContainText('已复制 2 个文件');
  expect((await fs.readdir(path.join(exports, '发给老师'))).sort()).toEqual([
    '封面.png',
    '说明.md',
  ]);
  expect(await fs.readFile(path.join(root, '封面.png'), 'utf8')).toBe('封面');
  await clearToast();
  pass('打包为 ZIP、复制到文件夹都得到完整文件，原文件留在原处');

  // A file renamed elsewhere is marked, skipped by the export and can be cleared.
  await fs.rename(path.join(root, '说明.md'), path.join(root, '说明-新.md'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const teacher = strip.getByRole('region', { name: '发给老师' });
  await expect(teacher).toContainText('1 个文件找不到了');
  await page.screenshot({ path: path.join(shots, '02-找不到的文件.png') });
  await fs.rm(zip);
  await setAction('发给老师', '打包为 ZIP…');
  await expect(toast).toContainText('跳过了 1 个找不到的文件');
  expect(Object.keys(unzipNames(await fs.readFile(zip)))).toEqual(['封面.png']);
  await clearToast();
  await setAction('发给老师', '移除 1 个找不到的文件');
  await expect(teacher).not.toContainText('说明.md');
  pass('外部改名的文件被标出，打包时跳过并说明，可一键移除');

  // Renaming and collecting into a planned folder.
  await setAction('发给老师', '重命名');
  await page.getByRole('dialog').getByRole('textbox').fill('发给王老师');
  await page.getByRole('dialog').getByRole('button', { name: '确认重命名' }).click();
  await expect(strip.getByRole('region', { name: '发给王老师' })).toBeVisible();
  await setAction('报销', '收进新文件夹');
  await expect(toast).toContainText('点“预览并应用”后才会移动');
  await expect(card('报销')).toBeVisible();
  await expect(page.locator('.apply-entry')).toHaveClass(/primary/);
  expect(await fs.readFile(path.join(root, '报价.xlsx'), 'utf8')).toBe('报价');
  await page.keyboard.press('Control+z');
  await expect(card('报销')).toHaveCount(0);
  pass('文件集可改名；收进新文件夹只改计划，可撤销');

  // The list view shows the sets too, and the strip folds away.
  await page.getByRole('button', { name: '列表视图' }).click();
  await expect(strip).toContainText('发给王老师');
  await page.getByRole('button', { name: /^文件集 2/ }).click();
  await expect(strip.getByRole('region')).toHaveCount(0);
  await page.screenshot({ path: path.join(shots, '03-列表收起.png') });
  await page.getByRole('button', { name: /^文件集 2/ }).click();
  await page.getByRole('button', { name: '画布视图' }).click();
  pass('列表视图也显示文件集，文件集栏可以收起');

  await setAction('报销', '删除文件集');
  await expect(strip.getByRole('region', { name: '报销' })).toHaveCount(0);
  await expect(card('封面.png').locator('.file-set-badge')).toHaveText('1');
  expect(errors).toEqual([]);
  pass('删除文件集不动文件；页面无报错');
} finally {
  await app?.close();
}
