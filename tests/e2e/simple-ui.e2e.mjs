import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// All fixtures, profiles and screenshots stay in the project. The child uses this
// directory as its temporary root, preserving the main process's test-profile guard.
const shots = path.resolve('test-results/简洁迭代');
await fs.mkdir(shots, { recursive: true });
const base = await fs.mkdtemp(path.join(shots, 'filecanvas-e2e-'));
const root = path.join(base, '示例文件'),
  data = path.join(base, '应用数据');
await fs.mkdir(path.join(root, '参考资料', '图片'), { recursive: true });
await fs.mkdir(path.join(root, '空文件夹'));
await fs.mkdir(data);
const svg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="${color}"/><circle cx="245" cy="40" r="20" fill="#fff5cd"/><path d="M0 160 100 40 180 130 240 80 320 160" fill="#ffffff88"/></svg>`;
const fixtures = {
  '需求说明.txt': '项目资料，仅用于界面验证。\n'.repeat(60),
  '报价清单.xlsx': Buffer.alloc(32 * 1024, 1),
  '合作方案.pdf': Buffer.alloc(48 * 1024, 2),
  '演示.pptx': Buffer.alloc(7 * 1024, 3),
  '交付素材.zip': Buffer.alloc(128 * 1024, 4),
  '处理脚本.py': 'print("example")\n',
  '配音.wav': Buffer.alloc(4096, 5),
  '封面.svg': svg('#7ab5a3'),
  '参考资料/说明.md': '# 参考说明\n虚构内容，仅用于本机验证。',
  '参考资料/图片/山景.svg': svg('#92b1c5'),
  '参考资料/图片/海报.svg': svg('#c0a8bf'),
};
for (const [name, contents] of Object.entries(fixtures))
  await fs.writeFile(path.join(root, name), contents);
// Stand-ins for the user's 下载 and 桌面, with files Windows and browsers keep for themselves.
const known = path.join(base, '常用位置'),
  downloads = path.join(known, '下载');
await fs.mkdir(path.join(known, '桌面'), { recursive: true });
await fs.mkdir(downloads);
for (const name of [
  '会议纪要.docx',
  '截图.png',
  '安装包.exe',
  'desktop.ini',
  '~$纪要.docx',
  '电影.mp4.crdownload',
])
  await fs.writeFile(path.join(downloads, name), name);
const env = {
  ...process.env,
  TEMP: shots,
  TMP: shots,
  FILECANVAS_E2E: '1',
  FILECANVAS_TEST_DATA: data,
  FILECANVAS_TEST_ROOT: root,
  FILECANVAS_TEST_KNOWN: known,
};
delete env.ELECTRON_RUN_AS_NODE;
async function fingerprint() {
  const result = {};
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result[path.relative(root, full)] = 'folder';
        await walk(full);
      } else
        result[path.relative(root, full)] = createHash('sha256')
          .update(await fs.readFile(full))
          .digest('hex');
    }
  }
  await walk(root);
  return result;
}
const before = await fingerprint(),
  errors = [],
  assertions = [];
const pass = (message) => {
  assertions.push(message);
  console.log(`PASS ${message}`);
};
let app, page;
try {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 800 });
  const card = (name) => page.locator(`[data-testid="canvas-card"][data-name="${name}"]`);
  const item = (name) => page.locator(`[data-testid="view-item"][data-name="${name}"]`);
  const clearToast = async () => {
    const close = page.getByRole('button', { name: '关闭提示', exact: true });
    if (await close.isVisible()) await close.click();
  };
  const more = async (label) => {
    await page.getByLabel('更多工具', { exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
  };
  const noOverflow = async () =>
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  const shot = async (name) => {
    if (!(await page.getByRole('menu').count())) await clearToast();
    await page.screenshot({ path: path.join(shots, name), animations: 'disabled' });
  };

  await expect(page.getByRole('button', { name: '选择文件夹，开始整理' })).toBeVisible();
  await expect(page.locator('.welcome-header > button:visible')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '整理下载', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '整理桌面', exact: true })).toBeVisible();
  await expect(page.locator('.welcome-recent')).toHaveCount(0);
  await shot('01-欢迎页.png');
  // Dragging files over the page shows where to drop; a drop without a real path (all a
  // synthetic test drop can carry) is refused with a clear message instead of opening anything.
  const dropData = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['x'], '不是真实路径.txt'));
    return data;
  });
  await page.dispatchEvent('main.welcome', 'dragover', { dataTransfer: dropData });
  await expect(page.getByTestId('welcome-drop')).toBeVisible();
  await shot('14-拖入打开.png');
  await page.dispatchEvent('main.welcome', 'drop', { dataTransfer: dropData });
  await expect(page.getByTestId('welcome-drop')).toHaveCount(0);
  await expect(page.locator('.toast')).toContainText('没有读到文件夹位置');
  await clearToast();
  await page.getByRole('button', { name: '选择文件夹，开始整理' }).click();
  await expect(page.locator('.statusbar')).toContainText('11 个文件 · 3 个文件夹');
  await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
  await expect(page.locator('.main-header').getByRole('button', { name: 'AI 助手' })).toBeHidden();
  await expect(page.getByTestId('suggestion-bar')).toHaveCount(0);
  await expect(page.getByTestId('operation-notice')).toBeHidden();
  await expect(page.getByRole('button', { name: '画布视图' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: '平铺视图' })).toHaveCount(0);
  await expect(card('参考资料').locator('.file-facts')).toContainText('3 个文件 · 1 个文件夹');
  await expect(card('参考资料').locator('.file-facts')).not.toContainText('画布内');
  await expect(card('参考资料').locator('.card-type')).toHaveText('');
  await expect(card('报价清单.xlsx').locator('.card-type')).toHaveText('表格');
  // New cards fill the visible width instead of a fixed five columns, without sideways scrolling.
  const canvasFit = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('.canvas-scroll');
      const lefts = [...document.querySelectorAll('[data-testid="canvas-card"]')].map(
        (el) => el.style.left,
      );
      return {
        columns: new Set(lefts).size,
        overflow: scroller.scrollWidth - scroller.clientWidth,
      };
    });
  const wide = await canvasFit();
  expect(wide.columns).toBeGreaterThanOrEqual(7);
  expect(wide.overflow).toBeLessThanOrEqual(1);
  await expect(card('参考资料').locator('.folder-types')).toHaveText('图片 / 文档');
  await expect(card('合作方案.pdf').locator('.card-type')).toContainText('PDF');
  await expect(card('报价清单.xlsx').locator('.file-facts')).toHaveText('32.0 KB');
  await expect(card('空文件夹').locator('.file-facts')).toHaveText('空文件夹');
  await shot('02-简洁画布.png');
  pass(
    '欢迎页只突出开始入口；主界面收起低频工具；文件夹嵌套统计与文件大小可见，卡片不重复类型文字；新卡片按窗口宽度排列',
  );

  const fileMenu = () => page.getByRole('menu', { name: '文件操作', exact: true });
  const backgroundMenu = () => page.getByRole('menu', { name: '画布操作', exact: true });
  const blankMenu = async () => {
    await clearToast();
    const surface = page.locator('.canvas-scroll');
    const box = await surface.boundingBox();
    await surface.click({ button: 'right', position: { x: box.width - 22, y: box.height - 24 } });
    await expect(backgroundMenu()).toBeVisible();
  };
  await expect(
    page.locator('.main-header').getByRole('button', { name: '新建文件夹' }),
  ).toHaveCount(0);
  await card('需求说明.txt').click({ button: 'right' });
  await expect(fileMenu().locator('.context-menu-title')).toHaveText('需求说明.txt');
  await expect(fileMenu().getByRole('menuitem', { name: '预览详情', exact: true })).toBeVisible();
  await expect(fileMenu().getByRole('menuitem', { name: '新建子文件夹' })).toHaveCount(0);
  await shot('10-文件右键.png');
  await fileMenu().getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('需求说明-修改.txt');
  await page.getByRole('button', { name: '确认重命名', exact: true }).click();
  await expect(card('需求说明-修改.txt')).toHaveCount(1);
  expect(await fingerprint()).toEqual(before);
  await page.keyboard.press('Control+z');
  await expect(card('需求说明.txt')).toHaveCount(1);

  await card('参考资料').click({ button: 'right' });
  await fileMenu().getByRole('menuitem', { name: '新建子文件夹', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('将在“参考资料”中新建');
  await page.getByLabel('名称', { exact: true }).fill('右键新建');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(card('参考资料').locator('.file-facts')).toContainText('2 个文件夹');
  await page.keyboard.press('Control+z');
  await expect(card('参考资料').locator('.file-facts')).toContainText('1 个文件夹');
  await card('参考资料').click({ button: 'right' });
  await fileMenu().getByRole('menuitem', { name: '在画布中展开', exact: true }).click();
  await expect(card('参考资料')).toHaveAttribute('data-expanded', 'true');
  await card('说明.md').click({ button: 'right' });
  await expect(fileMenu().locator('.context-menu-title')).toHaveText('说明.md');
  await fileMenu().getByRole('menuitem', { name: '预览详情', exact: true }).click();
  await expect(page.locator('.file-inspector .content-heading')).toContainText('说明.md');
  await page.getByRole('button', { name: '收起内容预览' }).click();
  await card('参考资料').locator('.folder-container-heading').click({ button: 'right' });
  await fileMenu().getByRole('menuitem', { name: '收起文件夹', exact: true }).click();
  await expect(card('参考资料')).toHaveAttribute('data-expanded', 'false');
  pass('文件右键可改名和撤销；文件夹内新建位置正确；嵌套文件右键不会被父文件夹菜单覆盖');

  await card('需求说明.txt').click();
  await card('合作方案.pdf').click({ modifiers: ['Control'] });
  await card('需求说明.txt').click({ button: 'right' });
  await expect(fileMenu().locator('.context-menu-title')).toHaveText('已选择 2 项');
  await expect(fileMenu().getByRole('menuitem', { name: '批量重命名', exact: true })).toBeVisible();
  await expect(fileMenu().getByRole('menuitem', { name: '预览详情', exact: true })).toHaveCount(0);
  await shot('11-多选右键.png');
  await fileMenu().getByRole('menuitem', { name: '移入新文件夹', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('多选归类');
  await page.getByRole('button', { name: '创建并移入', exact: true }).click();
  await expect(card('多选归类').locator('.folder-container-heading')).toContainText('2 个文件');
  expect(await fingerprint()).toEqual(before);
  await page.keyboard.press('Control+z');
  await expect(card('需求说明.txt')).toHaveCount(1);
  await card('需求说明.txt').click();
  await card('合作方案.pdf').click({ modifiers: ['Control'] });
  await card('交付素材.zip').click({ button: 'right' });
  await expect(fileMenu().locator('.context-menu-title')).toHaveText('交付素材.zip');
  await expect(fileMenu().getByRole('menuitem', { name: '批量重命名', exact: true })).toHaveCount(
    0,
  );
  await expect(fileMenu().getByRole('menuitem', { name: '移出画布', exact: true })).toContainText(
    '不删除本地文件',
  );
  await fileMenu().getByRole('menuitem', { name: '移出画布', exact: true }).click();
  await expect(card('交付素材.zip')).toHaveCount(0);
  expect(await fingerprint()).toEqual(before);
  await page.keyboard.press('Control+z');
  await expect(card('交付素材.zip')).toHaveCount(1);
  pass(
    '右键已选文件保留多选，归类只作用于选中两项；右键未选文件切换到单项；移出画布不删除本地文件',
  );

  await blankMenu();
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '新建文件夹', exact: true }),
  ).toBeVisible();
  await expect(backgroundMenu().getByRole('menuitem', { name: '重命名', exact: true })).toHaveCount(
    0,
  );
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '撤销未应用的修改', exact: true }),
  ).toBeEnabled();
  const menuBox = await backgroundMenu().boundingBox();
  expect(menuBox.x).toBeGreaterThanOrEqual(0);
  expect(menuBox.y).toBeGreaterThanOrEqual(0);
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(1280);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(800);
  await shot('12-空白处右键.png');
  await page.keyboard.press('End');
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '刷新并核对', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(backgroundMenu().getByRole('menuitem', { name: '重做', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '新建文件夹', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await page.getByLabel('名称', { exact: true }).fill('空白处新建');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(card('空白处新建')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(card('空白处新建')).toHaveCount(0);
  await blankMenu();
  await backgroundMenu().getByRole('menuitem', { name: '全选当前层', exact: true }).click();
  await expect(page.locator('.selection-toolbar')).toContainText('已选择 10 项');
  await expect(page.locator('.selection-toolbar').getByRole('button')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await card('空文件夹').click({ button: 'right' });
  await fileMenu().getByRole('menuitem', { name: '打开文件夹', exact: true }).click();
  await expect(page.locator('.breadcrumb')).toContainText('空文件夹');
  await blankMenu();
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '全选当前层', exact: true }),
  ).toBeDisabled();
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '排列当前层', exact: true }),
  ).toBeDisabled();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '新建文件集…', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '添加文件', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回上一级', exact: true }).click();
  await card('需求说明.txt').focus();
  await page.keyboard.press('Shift+F10');
  await expect(fileMenu().locator('.context-menu-title')).toHaveText('需求说明.txt');
  await page.keyboard.press('Escape');
  pass(
    '空白菜单可新建和全选；菜单在窗口边缘完整可见；键盘打开、跳转和禁用项处理正常；浮动栏只留操作与取消',
  );

  await card('需求说明.txt').click();
  await expect(page.locator('.file-inspector')).toHaveCount(0);
  await page.getByRole('button', { name: '所选文件操作', exact: true }).click();
  await fileMenu().getByRole('menuitem', { name: '预览详情', exact: true }).click();
  await expect(page.locator('.file-inspector .content-heading')).toContainText('文档 · TXT');
  await expect(page.locator('.text-preview')).toContainText('项目资料');
  await expect(page.locator('.inspector-ai')).not.toHaveAttribute('open');
  await expect(page.getByTestId('path-inspector')).toContainText('路径未变');
  await shot('03-预览详情.png');
  await page.getByRole('button', { name: '收起内容预览' }).click();
  await page.keyboard.press('Escape');
  await page.getByLabel('更多工具', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'AI 助手', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'AI 助手', exact: true })).toBeHidden();
  await page.getByLabel('更多工具', { exact: true }).click();
  await page.locator('.breadcrumb').click();
  await expect(page.getByRole('button', { name: 'AI 助手', exact: true })).toBeHidden();
  const dragSource = await card('需求说明.txt').boundingBox();
  const dragTarget = await card('空文件夹').boundingBox();
  await page.mouse.move(dragSource.x + 60, dragSource.y + 60);
  await page.mouse.down();
  await page.mouse.move(dragTarget.x + 60, dragTarget.y + 60, { steps: 12 });
  await page.mouse.up();
  await expect(card('空文件夹').locator('.file-facts')).toContainText('1 个文件');
  await expect(page.locator('.statusbar')).toContainText('1 项待变更');
  expect(await fingerprint()).toEqual(before);
  await page.keyboard.press('Control+z');
  await expect(card('空文件夹').locator('.file-facts')).toHaveText('空文件夹');
  await expect(page.locator('.statusbar')).toContainText('0 项待变更');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '画布选项', exact: true }).click();
  await backgroundMenu().getByRole('menuitem', { name: '按类型排列卡片', exact: true }).click();
  await expect(backgroundMenu()).toHaveCount(0);
  expect(await fingerprint()).toEqual(before);
  pass(
    '单击只选择，主动预览后显示内容；AI 默认收起；菜单可用 Esc/点击外部关闭；画布拖入文件夹及撤销正常，排列不改变真实文件',
  );

  await page.getByRole('button', { name: '列表视图' }).click();
  await item('合作方案.pdf').click({ button: 'right' });
  await expect(fileMenu().locator('.context-menu-title')).toHaveText('合作方案.pdf');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '视图选项', exact: true }).click();
  await expect(
    backgroundMenu().getByRole('menuitem', { name: '新建文件夹', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(item('合作方案.pdf').locator('.col-size')).toHaveText('48.0 KB');
  await expect(item('参考资料').locator('.col-size')).not.toHaveText('0 B');
  await item('需求说明.txt').dragTo(item('空文件夹'));
  await expect(page.locator('.statusbar')).toContainText('1 项待变更');
  await expect(item('空文件夹').locator('.col-size')).not.toHaveText('0 B');
  expect(await fingerprint()).toEqual(before);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.statusbar')).toContainText('0 项待变更');
  await shot('04-列表.png');
  pass('列表显示类型和容量，拖动归类会更新文件夹统计，撤销后还原，硬盘未改动');

  await more('界面设置');
  const settings = page.getByRole('dialog', { name: '界面设置' });
  await settings.getByRole('radio', { name: '平铺', exact: true }).click();
  await expect(page.getByRole('button', { name: '平铺视图' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(item('参考资料').locator('.file-facts')).toContainText('3 个文件');
  await settings.getByRole('radio', { name: '分组', exact: true }).click();
  await expect(page.locator('.group-head').first()).toContainText('文件夹');
  await settings.getByRole('radio', { name: '画布', exact: true }).click();
  await settings.getByRole('button', { name: '完成', exact: true }).click();
  await page.setViewportSize({ width: 1000, height: 680 });
  await noOverflow();
  await blankMenu();
  const compactMenu = await backgroundMenu().boundingBox();
  expect(compactMenu.x + compactMenu.width).toBeLessThanOrEqual(1000);
  expect(compactMenu.y + compactMenu.height).toBeLessThanOrEqual(680);
  await shot('13-小窗口右键.png');
  await page.keyboard.press('Escape');
  await blankMenu();
  await backgroundMenu()
    .getByRole('menuitem', { name: /排列当前层/ })
    .click();
  expect((await canvasFit()).overflow).toBeLessThanOrEqual(1);
  await shot('05-小窗口.png');
  await page.setViewportSize({ width: 1280, height: 800 });
  pass(
    '设置内仍可使用平铺和分组；切回画布保留操作；1000×680 页面无横向溢出，排列后画布也无横向滚动',
  );

  await page.getByRole('button', { name: '自动分类', exact: true }).click();
  const draft = page.getByRole('dialog', { name: '自动分类', exact: true });
  await expect(draft.getByLabel('分类方式')).toHaveValue('type');
  await draft.getByLabel('分类方式').selectOption('custom');
  await expect(draft).toContainText('还没有规则');
  await draft.getByLabel('分类方式').selectOption('type');
  await expect(draft.getByRole('switch', { name: '整理到 PDF', exact: true })).toBeVisible();
  // Every root type has one file here, so merging changes nothing and the switch stays hidden.
  await expect(draft.getByLabel('零散类型合并到“其他”')).toHaveCount(0);
  await shot('06-自动分类.png');
  await draft.getByRole('button', { name: '采用草案到画布' }).click();
  await expect(page.getByTestId('pending-chip')).toContainText('尚未应用');
  await expect(page.getByTestId('operation-notice')).toBeHidden();
  expect(await fingerprint()).toEqual(before);
  await page.keyboard.press('Control+z');
  await expect(page.locator('.statusbar')).toContainText('0 项待变更');
  await page.keyboard.press('Control+y');
  await expect(page.getByTestId('pending-chip')).toContainText('尚未应用');
  await shot('07-分类后的画布.png');
  await page.getByRole('button', { name: /预览并应用/ }).click();
  const preview = page.getByRole('dialog', { name: '预览整理结果' });
  await expect(preview.locator('.preview-summary .warning-text')).toHaveCount(0);
  await expect(page.getByTestId('preview-summary')).toContainText('移动');
  await expect(page.getByTestId('preview-summary')).toContainText('新建文件夹');
  await expect(page.getByTestId('preview-summary')).not.toContainText('路径未改变');
  await preview.getByRole('button', { name: '结构对照', exact: true }).click();
  await expect(page.getByTestId('after-tree')).toContainText('合作方案.pdf');
  await shot('08-应用前预览.png');
  expect(await fingerprint()).toEqual(before);
  await preview.getByRole('button', { name: '应用到本地文件', exact: true }).click();
  await expect(preview).toHaveCount(0, { timeout: 20000 });
  await expect(page.locator('.canvas-safe')).toContainText('已应用并核验');
  // The completion report: counts, a before/after card with file names hidden by default.
  const report = page.getByRole('dialog', { name: '整理完成', exact: true });
  await expect(page.getByTestId('report-summary')).toContainText('移动');
  await expect(page.getByTestId('report-summary')).toContainText('新建文件夹');
  const compare = page.getByTestId('compare-card');
  await expect(compare).toContainText('整理前');
  await expect(compare).toContainText('散放文件 8 个');
  await expect(compare.locator('.compare-pane').last()).toContainText('还有 4 个文件夹');
  await expect(compare.locator('.compare-pane').first()).toContainText('散放 8 个文件');
  await expect(compare.locator('.compare-pane').last()).toContainText('没有散放文件');
  await expect(compare.locator('.compare-pane').last().locator('.compare-loose')).toHaveCount(0);
  await expect(compare).not.toContainText('合作方案.pdf');
  await report.getByLabel(/图中显示文件名/).check();
  await expect(compare).toContainText('合作方案.pdf');
  await report.getByLabel(/图中显示文件名/).uncheck();
  await shot('09-完成报告.png');
  await report.getByRole('button', { name: '保存对比图', exact: true }).click();
  await expect(report.locator('.report-saved')).toContainText('FileCanvas-整理前后对比');
  const exported = (await fs.readdir(path.join(data, 'exports'))).filter((n) => n.endsWith('.png'));
  expect(exported).toHaveLength(1);
  const png = await fs.readFile(path.join(data, 'exports', exported[0]));
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  await fs.copyFile(path.join(data, 'exports', exported[0]), path.join(shots, '15-对比图.png'));
  const after = await fingerprint();
  expect(after[path.join('PDF', '合作方案.pdf')]).toBe(before['合作方案.pdf']);
  expect(after['合作方案.pdf']).toBeUndefined();
  expect(
    Object.values(after)
      .filter((value) => value !== 'folder')
      .sort(),
  ).toEqual(
    Object.values(before)
      .filter((value) => value !== 'folder')
      .sort(),
  );
  // The way back is offered right in the report.
  await report.getByRole('button', { name: '恢复上次文件移动', exact: true }).click();
  await expect(report).toHaveCount(0);
  await page.getByRole('button', { name: '恢复文件原位置', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20000 });
  expect(await fingerprint()).toEqual(before);
  pass(
    '自动分类默认按类型，其他规则按需选择；分类可撤销/重做；真实应用后所有文件 SHA256 保持一致，恢复后完整目录一致',
  );
  pass('应用后出现完成报告：计数、整理前后对比默认隐藏文件名，可保存为 PNG，并可从报告直接恢复');

  // The 打开 menu offers common places and recent projects; system files and downloads in
  // progress in 下载 are never put on the canvas.
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  const openMenu = page.getByRole('menu', { name: '打开', exact: true });
  await expect(openMenu.getByRole('menuitem', { name: '整理桌面' })).toBeVisible();
  await openMenu.getByRole('menuitem', { name: '整理下载' }).click();
  await expect(page.locator('.statusbar')).toContainText('共 3 个文件');
  for (const name of ['会议纪要.docx', '截图.png', '安装包.exe'])
    await expect(card(name)).toBeVisible();
  for (const name of ['desktop.ini', '~$纪要.docx', '电影.mp4.crdownload'])
    await expect(card(name)).toHaveCount(0);
  // An unapplied plan in 下载 is not lost: opening 下载 again brings that plan back.
  await blankMenu();
  await backgroundMenu().getByRole('menuitem', { name: '新建文件夹', exact: true }).click();
  await page.getByLabel('名称', { exact: true }).fill('待整理');
  await page.getByRole('button', { name: '创建', exact: true }).click();
  await expect(card('待整理')).toHaveCount(1);
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await openMenu.getByRole('menuitem', { name: '示例文件' }).click();
  await expect(page.locator('.statusbar')).toContainText('共 11 个文件');
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await openMenu.getByRole('menuitem', { name: '整理下载' }).click();
  await expect(card('待整理')).toHaveCount(1);
  await expect(page.locator('.toast')).toContainText('上次没应用的整理计划');
  await clearToast();
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  // The project that is open now is not offered again under the recent projects.
  await expect(openMenu.getByRole('menuitem', { name: '下载', exact: true })).toHaveCount(0);
  await shot('16-打开菜单.png');
  await page.keyboard.press('Escape');
  await expect(openMenu).toHaveCount(0);
  // With nothing left unapplied, opening 下载 again reuses its project and picks up new files,
  // instead of saving yet another 下载 project.
  await card('待整理').click({ button: 'right' });
  await fileMenu().getByRole('menuitem', { name: '移出画布', exact: true }).click();
  await expect(card('待整理')).toHaveCount(0);
  await fs.writeFile(path.join(downloads, '新下载.pdf'), '新下载');
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await openMenu.getByRole('menuitem', { name: '示例文件' }).click();
  await expect(page.locator('.statusbar')).toContainText('共 11 个文件');
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await openMenu.getByRole('menuitem', { name: '整理下载' }).click();
  await expect(page.locator('.toast')).toContainText('按文件夹现状更新');
  await expect(card('新下载.pdf')).toHaveCount(1);
  await expect(page.locator('.statusbar')).toContainText('共 4 个文件');
  await clearToast();
  const projects = path.join(data, 'projects');
  const downloadsRoot = (await fs.realpath(downloads)).toLowerCase();
  let downloadProjects = 0;
  for (const name of await fs.readdir(projects))
    if (name.endsWith('.json') && name !== 'last-project.json') {
      const saved = JSON.parse(await fs.readFile(path.join(projects, name), 'utf8'));
      if (saved.rootPath.toLowerCase() === downloadsRoot) downloadProjects++;
    }
  expect(downloadProjects).toBe(1);
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await openMenu.getByRole('menuitem', { name: '示例文件' }).click();
  await expect(page.locator('.statusbar')).toContainText('共 11 个文件');
  pass(
    '打开菜单提供下载、桌面和最近项目；系统文件、Office 临时文件和下载中的文件不进入画布；再次整理下载会回到未应用的计划，没有未应用的修改时沿用同一个项目并加入新文件',
  );

  // Show every tutorial step after changing control locations.
  await more('新手教程');
  for (let step = 0; step < 5; step++) {
    await expect(page.locator('.tour-card')).toBeVisible();
    await noOverflow();
    await page
      .getByRole('button', { name: step === 4 ? '开始整理' : '下一步', exact: true })
      .click();
  }
  expect(await fingerprint()).toEqual(before);
  expect(errors).toEqual([]);
  pass('五步教程的入口和控件仍可操作，无页面运行错误');
  await fs.writeFile(
    path.join(shots, '验收.json'),
    JSON.stringify({ status: 'passed', base, assertions, errors }, null, 2),
  );
} catch (error) {
  if (page) await page.screenshot({ path: path.join(shots, '失败现场.png') }).catch(() => {});
  await fs.writeFile(
    path.join(shots, '验收.json'),
    JSON.stringify({ status: 'failed', base, assertions, errors, error: String(error) }, null, 2),
  );
  throw error;
} finally {
  if (app) await app.close();
}
