import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

// Everyday flow on a folder that looks like Downloads: suggestion strip -> recipe
// preview with one group switched off -> adopt -> filter -> select matches -> move
// into a new folder -> batch rename -> apply to disk -> restore. Real paths and file
// bytes are checked at every step that touches the disk.
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-smart-'));
const data = path.join(base, '应用数据');
const root = path.join(base, '下载');
await fs.mkdir(data);
await fs.mkdir(root);
const DAY = 86_400_000;
const files = {
  '发票-三月.pdf': 0,
  '发票-四月.pdf': 0,
  '合同.docx': 0,
  '旅行1.jpg': 0,
  '旅行2.jpg': 0,
  '旅行3.jpg': 0,
  '预算.xlsx': 0,
  '汇报.pptx': 0,
  'setup.exe': 0,
  '笔记.md': 0,
  '老文件.txt': 400,
  '老照片.png': 500,
};
for (const [name, age] of Object.entries(files)) {
  const file = path.join(root, name);
  await fs.writeFile(file, `内容：${name}`);
  if (age) {
    const old = new Date(Date.now() - age * DAY);
    await fs.utimes(file, old, old);
  }
}
const env = {
  ...process.env,
  FILECANVAS_E2E: '1',
  FILECANVAS_TEST_DATA: data,
  FILECANVAS_TEST_ROOT: root,
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const assertions = [];
const pass = (message) => {
  assertions.push(message);
  console.log(`PASS ${message}`);
};
async function snapshot() {
  const result = {};
  async function walk(dir) {
    for (const item of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      result[path.relative(root, full)] = item.isDirectory()
        ? 'folder'
        : createHash('sha256')
            .update(await fs.readFile(full))
            .digest('hex');
      if (item.isDirectory()) await walk(full);
    }
  }
  await walk(root);
  return result;
}
const original = await snapshot();
const shots = '03_测试结果/智能整理';
await fs.mkdir(shots, { recursive: true });
let app;
try {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1000, height: 680 });
  const noOverflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const closeToast = async () => {
    const close = page.getByRole('button', { name: '关闭提示', exact: true });
    if (await close.isVisible()) await close.click();
  };

  // 1. Opening a folder proposes next steps instead of leaving the user to find them.
  await page.getByRole('button', { name: '选择文件夹，开始整理' }).click();
  await expect(page.locator('.statusbar')).toContainText('12 个文件 · 0 个文件夹');
  const strip = page.getByTestId('suggestion-bar');
  await expect(strip).toContainText('12');
  await expect(strip.getByRole('button', { name: /按文件类型/ })).toBeVisible();
  await expect(strip.getByRole('button', { name: /久未修改归档/ })).toContainText('2 个旧文件');
  await closeToast();
  await page.screenshot({ path: `${shots}/01-打开文件夹后的建议.png` });
  expect(await noOverflow()).toBe(true);
  pass('打开普通文件夹后显示整理建议条（按类型、按月份、久未修改归档），1000×680 无溢出');

  // 1b. Right-click offers the common actions, including "show in Explorer".
  const contract = page.locator('[data-testid="canvas-card"][data-name="合同.docx"]');
  await contract.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '文件操作' });
  await expect(menu.getByRole('menuitem', { name: '在资源管理器中显示' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '移入新文件夹' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '重命名' })).toBeVisible();
  await page.screenshot({ path: `${shots}/01b-右键菜单.png` });
  await menu.getByRole('menuitem', { name: '在资源管理器中显示' }).click();
  await expect(page.getByRole('status')).toContainText('已在资源管理器中定位');
  await contract.click({ button: 'right' });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await contract.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: '移入新文件夹' }).click();
  await expect(page.getByRole('dialog', { name: '把 1 项移入新文件夹' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('0 项待变更');
  await page.keyboard.press('Escape');
  await closeToast();
  pass('右键菜单：在资源管理器中显示、移入新文件夹等；Esc 关闭，不改变计划');

  // 1c. Saved rules: write rules, see live counts, adopt as one undo step, nothing on disk.
  const rulesFile = path.join(data, 'rules.json');
  await page.getByRole('button', { name: '分类草案', exact: true }).click();
  const rulesDraft = page.getByRole('dialog', { name: '先生成一份分类草案' });
  await rulesDraft.getByRole('button', { name: /我的规则/ }).click();
  await expect(rulesDraft.getByRole('button', { name: /我的规则/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(rulesDraft).toContainText('还没有规则');
  await page.screenshot({ path: `${shots}/01c0-我的规则-空列表.png` });
  const addRule = async (rule) => {
    await rulesDraft.getByRole('button', { name: '添加规则', exact: true }).click();
    await rulesDraft.getByLabel('规则名称', { exact: true }).fill(rule.name);
    await rulesDraft.getByLabel('目标文件夹', { exact: true }).fill(rule.folder);
    if (rule.keywords)
      await rulesDraft.getByLabel('名称包含的关键词', { exact: true }).fill(rule.keywords);
    if (rule.extensions)
      await rulesDraft.getByLabel('文件扩展名', { exact: true }).fill(rule.extensions);
    if (rule.days) await rulesDraft.getByLabel('至少多少天没改过', { exact: true }).fill(rule.days);
    await rulesDraft.getByRole('button', { name: '保存规则', exact: true }).click();
  };
  const ruleRow = (name) => rulesDraft.locator('.rule-row', { hasText: name });
  await addRule({ name: '发票', folder: '财务\\发票', keywords: '发票', extensions: '.PDF' });
  await expect(ruleRow('发票')).toContainText('命中 2 个');
  await expect(ruleRow('发票')).toContainText('财务/发票');
  await expect(rulesDraft).toContainText('10 个文件不符合任何规则，保持原位');
  await addRule({ name: '旧文件', folder: '归档', days: '365' });
  await expect(ruleRow('旧文件')).toContainText('命中 2 个');
  await expect(rulesDraft).toContainText('8 个文件不符合任何规则，保持原位');
  await addRule({ name: '全部 PDF', folder: 'PDF文档', extensions: 'pdf' });
  await expect(ruleRow('全部 PDF')).toContainText('命中 0 个');
  await expect(ruleRow('全部 PDF')).toContainText('另有 2 个已被前面的规则归类');
  await page.screenshot({ path: `${shots}/01d-规则优先级与被抢先的命中数.png` });
  // A second rule with the same name is refused; Esc closes only the form.
  await rulesDraft.getByRole('button', { name: '添加规则', exact: true }).click();
  await rulesDraft.getByLabel('规则名称', { exact: true }).fill('发票');
  await rulesDraft.getByLabel('目标文件夹', { exact: true }).fill('别处');
  await rulesDraft.getByLabel('名称包含的关键词', { exact: true }).fill('x');
  await expect(rulesDraft).toContainText('已有同名规则');
  await expect(rulesDraft.getByRole('button', { name: '保存规则', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${shots}/01e-编辑规则与同名提示.png` });
  await page.keyboard.press('Escape');
  await expect(rulesDraft.getByLabel('规则名称', { exact: true })).toHaveCount(0);
  await expect(rulesDraft).toBeVisible();
  // List order decides who wins: moving the PDF rule to the top hands it the invoices.
  await rulesDraft.getByRole('button', { name: '上移“全部 PDF”', exact: true }).click();
  await rulesDraft.getByRole('button', { name: '上移“全部 PDF”', exact: true }).click();
  await expect(ruleRow('全部 PDF')).toContainText('命中 2 个');
  await expect(ruleRow('发票')).toContainText('命中 0 个');
  await rulesDraft.getByRole('button', { name: '下移“全部 PDF”', exact: true }).click();
  await rulesDraft.getByRole('button', { name: '下移“全部 PDF”', exact: true }).click();
  await expect(ruleRow('发票')).toContainText('命中 2 个');
  // Deleting asks first.
  await rulesDraft.getByRole('button', { name: '删除“全部 PDF”', exact: true }).click();
  await rulesDraft.getByRole('button', { name: '保留', exact: true }).click();
  await expect(ruleRow('全部 PDF')).toBeVisible();
  await rulesDraft.getByRole('button', { name: '删除“全部 PDF”', exact: true }).click();
  await rulesDraft.getByRole('button', { name: '确认删除“全部 PDF”', exact: true }).click();
  await expect(rulesDraft.locator('.rule-row')).toHaveCount(2);
  await expect(rulesDraft).toContainText('4 个文件');
  await expect(rulesDraft).toContainText('2 个目标文件夹');
  await expect(rulesDraft.getByRole('switch', { name: '整理到 财务/发票' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.screenshot({ path: `${shots}/01c-我的规则.png` });
  expect(await noOverflow()).toBe(true);
  // The rules are on disk in the app data directory, versioned and in order.
  const saved = JSON.parse(await fs.readFile(rulesFile, 'utf8'));
  expect(saved.version).toBe(1);
  expect(saved.rules.map((r) => [r.name, r.folder])).toEqual([
    ['发票', '财务/发票'],
    ['旧文件', '归档'],
  ]);
  expect(saved.rules[0].match).toEqual({ keywords: ['发票'], extensions: ['pdf'] });
  expect(saved.rules[1].match).toEqual({ olderThanDays: 365 });
  expect(await snapshot()).toEqual(original);
  await rulesDraft.getByRole('button', { name: '采用草案到画布' }).click();
  await expect(page.locator('.statusbar')).toContainText('12 个文件 · 3 个文件夹');
  expect(await snapshot()).toEqual(original);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.statusbar')).toContainText('12 个文件 · 0 个文件夹');
  await closeToast();
  // Reopening the dialog reads the rules back from disk.
  await page.getByRole('button', { name: '分类草案', exact: true }).click();
  await rulesDraft.getByRole('button', { name: /我的规则/ }).click();
  await expect(rulesDraft.locator('.rule-row')).toHaveCount(2);
  await expect(ruleRow('旧文件')).toContainText('命中 2 个');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await closeToast();
  pass(
    '我的规则：添加/排序/删除、实时命中数、多层文件夹、采用一步撤销，规则以 JSON 存入应用数据目录且重开可读回；磁盘不变',
  );

  // 2. The preview is grouped by target folder and a group can be switched off.
  await strip.getByRole('button', { name: /按文件类型/ }).click();
  const draft = page.getByRole('dialog', { name: '先生成一份分类草案' });
  await expect(draft.getByRole('button', { name: /按文件类型/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(draft).toContainText('12 个文件');
  const pdfSwitch = draft.getByRole('switch', { name: '整理到 PDF' });
  await expect(pdfSwitch).toHaveAttribute('aria-checked', 'true');
  await pdfSwitch.click();
  await expect(pdfSwitch).toHaveAttribute('aria-checked', 'false');
  await expect(draft).toContainText('10 个文件');
  await draft.locator('.draft-group-title', { hasText: '图片' }).click();
  await expect(draft).toContainText('老照片.png');
  // Clicking the active recipe again keeps the switches as they are.
  await draft.getByRole('button', { name: /按文件类型/ }).click();
  await expect(pdfSwitch).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: `${shots}/02-分组预览与开关.png` });
  expect(await snapshot()).toEqual(original);
  await draft.getByRole('button', { name: '采用草案到画布' }).click();
  await expect(page.locator('.statusbar')).toContainText('12 个文件 · 5 个文件夹');
  expect(await snapshot()).toEqual(original);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.statusbar')).toContainText('12 个文件 · 0 个文件夹');
  await page.keyboard.press('Control+y');
  await expect(page.locator('.statusbar')).toContainText('12 个文件 · 5 个文件夹');
  pass('分类草案按目标文件夹分组，可关闭 PDF 组；采用只改画布，一次撤销/重做，磁盘不变');

  // 3. Filter, select the matches and gather them into a new folder.
  await closeToast();
  const filter = page.getByLabel('筛选当前层文件');
  await page.keyboard.press('Control+f');
  await expect(filter).toBeFocused();
  await filter.fill('旅行');
  await expect(page.locator('.filter-count')).toHaveText('3 项匹配');
  await expect(page.locator('.canvas-card.dimmed').first()).toBeVisible();
  await expect(page.locator('.filter-badge')).toContainText('含 3 个匹配');
  await page.screenshot({ path: `${shots}/03-筛选.png` });
  await page.getByRole('button', { name: '选中匹配项', exact: true }).click();
  await expect(page.locator('.selection-toolbar')).toContainText('已选择 3 项');
  await page.getByRole('button', { name: '移入新文件夹', exact: true }).click();
  const collect = page.getByRole('dialog', { name: '把 3 项移入新文件夹' });
  await expect(collect.getByLabel('名称')).toHaveValue('图片');
  await collect.getByLabel('名称').fill('旅行照片');
  await page.screenshot({ path: `${shots}/04-移入新文件夹.png` });
  await collect.getByRole('button', { name: '创建并移入', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.statusbar')).toContainText('12 个文件 · 6 个文件夹');
  expect(await snapshot()).toEqual(original);
  pass('Ctrl+F 筛选、选中匹配项、移入新文件夹（默认名取自文件类型）；新文件夹建在原所在文件夹里');

  // 4. Batch rename the two invoices that stayed at the top level.
  await filter.fill('发票');
  await expect(page.locator('.filter-count')).toHaveText('2 项匹配');
  await page.getByRole('button', { name: '选中匹配项', exact: true }).click();
  await page.getByRole('button', { name: '批量重命名', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '批量重命名 2 项' });
  await rename.getByLabel('命名模板').fill('财务_{n}');
  await expect(rename).toContainText('财务_01.pdf');
  await expect(rename).toContainText('财务_02.pdf');
  await expect(rename).toContainText('名称都合法，没有重名');
  await rename.getByLabel('命名模板').fill('财务_{n}?');
  await expect(rename.getByRole('button', { name: '应用批量重命名' })).toBeDisabled();
  await rename.getByLabel('命名模板').fill('财务_{n}');
  await page.screenshot({ path: `${shots}/05-批量重命名.png` });
  await rename.getByRole('button', { name: '应用批量重命名' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  expect(await snapshot()).toEqual(original);
  pass('批量重命名实时预览、非法名称禁用应用、扩展名保留；应用前磁盘不变');

  // 5. Apply for real, check the paths on disk, then restore.
  await page.getByRole('button', { name: /检查并应用/ }).click();
  await expect(page.getByRole('dialog', { name: '预览整理结果' })).toBeVisible();
  await closeToast();
  await page.screenshot({ path: `${shots}/06-应用前核对.png` });
  await page.getByRole('button', { name: '应用到本地文件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('已应用并核验');
  const applied = await snapshot();
  const expectedPaths = [
    '财务_01.pdf',
    '财务_02.pdf',
    '文档/合同.docx',
    '文档/笔记.md',
    '文档/老文件.txt',
    '图片/老照片.png',
    '图片/旅行照片/旅行1.jpg',
    '图片/旅行照片/旅行2.jpg',
    '图片/旅行照片/旅行3.jpg',
    '表格/预算.xlsx',
    '演示/汇报.pptx',
    '安装包/setup.exe',
  ].map((p) => p.split('/').join(path.sep));
  for (const p of expectedPaths) expect(applied[p], p).toBeTruthy();
  expect(Object.keys(applied).filter((p) => !applied[p] || applied[p] !== 'folder').length).toBe(
    12,
  );
  expect(applied['财务_01.pdf']).toBe(original['发票-三月.pdf']);
  expect(applied['财务_02.pdf']).toBe(original['发票-四月.pdf']);
  expect(Object.keys(applied)).not.toContain('发票-三月.pdf');
  pass('真实磁盘：12 个文件按计划移动/改名，内容摘要一致');
  await page.getByLabel('更多工具').click();
  await page.getByRole('button', { name: '恢复上次文件移动', exact: true }).first().click();
  await page.getByRole('button', { name: '恢复文件原位置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('恢复到原位置');
  expect(await snapshot()).toEqual(original);
  pass('恢复上次文件移动后，目录树与原始文件摘要完全一致');
  // 6. The same engine creates the nested folder chain on disk, and restoring removes it.
  await closeToast();
  await page.getByRole('button', { name: '分类草案', exact: true }).click();
  await rulesDraft.getByRole('button', { name: /我的规则/ }).click();
  await expect(rulesDraft.locator('.rule-row')).toHaveCount(2);
  await rulesDraft.getByRole('button', { name: '采用草案到画布' }).click();
  await expect(page.locator('.statusbar')).toContainText('12 个文件 · 3 个文件夹');
  await closeToast();
  await page.getByRole('button', { name: /检查并应用/ }).click();
  await expect(page.getByRole('dialog', { name: '预览整理结果' })).toBeVisible();
  await closeToast();
  await page.getByRole('button', { name: '应用到本地文件', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('已应用并核验');
  const chained = await snapshot();
  const at = (...parts) => parts.join(path.sep);
  expect(chained['财务']).toBe('folder');
  expect(chained[at('财务', '发票')]).toBe('folder');
  expect(chained[at('财务', '发票', '发票-三月.pdf')]).toBe(original['发票-三月.pdf']);
  expect(chained[at('财务', '发票', '发票-四月.pdf')]).toBe(original['发票-四月.pdf']);
  expect(chained[at('归档', '老文件.txt')]).toBe(original['老文件.txt']);
  expect(chained[at('归档', '老照片.png')]).toBe(original['老照片.png']);
  expect(chained['合同.docx']).toBe(original['合同.docx']);
  expect(Object.values(chained).filter((v) => v !== 'folder')).toHaveLength(12);
  await page.getByLabel('更多工具').click();
  await page.getByRole('button', { name: '恢复上次文件移动', exact: true }).first().click();
  await page.getByRole('button', { name: '恢复文件原位置', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('恢复到原位置');
  expect(await snapshot()).toEqual(original);
  pass(
    '我的规则真实应用：多层文件夹 财务/发票 与 归档 由引擎创建并核验，未命中的文件原样；恢复后与原始摘要一致',
  );
  expect(errors).toEqual([]);
  await fs.writeFile(
    '03_测试结果/smart-organize-acceptance.json',
    JSON.stringify({ status: 'passed', base, assertions, errors }, null, 2),
    'utf8',
  );
} catch (error) {
  if (app)
    try {
      await (await app.firstWindow()).screenshot({ path: `${shots}/failure.png` });
    } catch {}
  await fs.writeFile(
    '03_测试结果/smart-organize-acceptance.json',
    JSON.stringify({ status: 'failed', base, assertions, errors, error: String(error) }, null, 2),
    'utf8',
  );
  throw error;
} finally {
  if (app) await app.close();
}
