import { _electron as electron, expect } from '@playwright/test';
import electronPath from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// What a real desktop run has to prove beyond the unit tests: a folder that is too big, a save
// that fails, a crashed page and files changing behind the program's back. Nothing here touches
// real user data: fixtures and the profile stay in the project's ignored results folder.
const shots = path.resolve('03_测试结果/成熟度检查');
await fs.mkdir(shots, { recursive: true });
const base = await fs.mkdtemp(path.join(shots, 'filecanvas-e2e-'));
const root = path.join(base, '资料'),
  known = path.join(base, '常用位置'),
  downloads = path.join(known, '下载'),
  data = path.join(base, '应用数据');
await fs.mkdir(root);
await fs.mkdir(path.join(known, '桌面'), { recursive: true });
await fs.mkdir(downloads);
await fs.mkdir(data);
await fs.writeFile(path.join(root, '计划.txt'), '计划内容');
await fs.writeFile(path.join(root, '清单.pdf'), 'pdf');
// “中文报告” in GBK, as saved by Notepad on older Chinese Windows.
await fs.writeFile(
  path.join(root, '旧记录.txt'),
  Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xa8, 0xb8, 0xe6]),
);
// A subfolder holding a link, which used to stop the whole folder from loading.
await fs.mkdir(path.join(root, '含链接'));
await fs.writeFile(path.join(root, '含链接', '普通.txt'), '普通');
await fs.symlink(path.join(base, '常用位置'), path.join(root, '含链接', '联接'), 'junction');
// More direct entries than a project can hold.
const huge = 5003;
for (let i = 0; i < huge; i += 500)
  await Promise.all(
    Array.from({ length: Math.min(500, huge - i) }, (_, k) =>
      fs.writeFile(path.join(downloads, `下载${i + k}.txt`), ''),
    ),
  );
const env = {
  ...process.env,
  TEMP: shots,
  TMP: shots,
  FILECANVAS_E2E: '1',
  FILECANVAS_TEST_DATA: data,
  FILECANVAS_TEST_ROOT: root,
  FILECANVAS_TEST_KNOWN: known,
  FILECANVAS_TEST_WINDOW_STATE: '1',
};
delete env.ELECTRON_RUN_AS_NODE;
const pass = (message) => console.log(`PASS ${message}`);
const launch = async () => {
  const app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  return { app, page };
};
const exited = (app) => new Promise((resolve) => app.process().once('exit', resolve));
const errors = [];
let { app, page } = await launch();
try {
  page.on('pageerror', (error) => errors.push(error.message));
  const card = (name) => page.locator(`[data-testid="canvas-card"][data-name="${name}"]`);
  const status = page.locator('.statusbar');
  const saved = page.getByTestId('save-state');
  const toast = page.locator('.toast');
  const clearToast = async () => {
    const close = page.getByRole('button', { name: '关闭提示', exact: true });
    if (await close.isVisible()) await close.click();
  };
  const more = async (label) => {
    await page.getByLabel('更多工具', { exact: true }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
  };

  // A nested link no longer costs the user the rest of the folder.
  await page.getByRole('button', { name: '选择文件夹，开始整理' }).click();
  await expect(card('计划.txt')).toBeVisible();
  await expect(status).toContainText('4 个文件');
  await expect(toast).toContainText('1 个无法读取或属于链接的条目已跳过');
  await clearToast();
  pass('子文件夹里有目录联接时，其余内容照常打开，并说明跳过了几项');

  // GBK works in the real Electron build, not only under Node.
  const content = await page.evaluate(async () => {
    const restored = (await window.fileCanvas.restore()).data;
    const node = Object.values(restored.nodes).find((n) => n.name === '旧记录.txt');
    return (await window.fileCanvas.readContent(node.source.path)).data;
  });
  expect(content.text).toBe('中文报告');
  pass('GBK 编码的文本文件在桌面版中可以正常预览');

  // Files changing outside are reported when the user comes back, and only reported.
  await fs.writeFile(path.join(root, '外部新增.txt'), '新');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(200);
  await expect(card('外部新增.txt')).toHaveCount(0);
  await page.evaluate(async () => {
    // The check runs at most every 15 s; opening a project always runs it.
    const { data: list } = await window.fileCanvas.projects();
    await window.fileCanvas.load(list[0].id);
  });
  await page.reload();
  await expect(page.getByTestId('external-changes')).toContainText('1 处变化');
  await page.getByTestId('external-changes').click();
  await expect(page.locator('.refresh-summary')).toContainText('新发现：1');
  await page.getByRole('button', { name: '采用刷新结果', exact: true }).click();
  await expect(card('外部新增.txt')).toBeVisible();
  await expect(page.getByTestId('external-changes')).toHaveCount(0);
  pass('外部新增文件会提示“文件夹有 1 处变化”，核对后才加入画布');

  // F5 and Ctrl+O reach their dialogs.
  await page.keyboard.press('F5');
  await expect(page.locator('.refresh-summary')).toBeVisible();
  await page.getByRole('button', { name: '取消，保留原计划', exact: true }).click();
  pass('F5 打开刷新并核对');

  // Taken off the canvas: refreshing does not bring it back.
  await card('清单.pdf').click({ button: 'right' });
  await page
    .getByRole('menu', { name: '文件操作', exact: true })
    .getByRole('menuitem', { name: '移出画布', exact: true })
    .click();
  await expect(card('清单.pdf')).toHaveCount(0);
  await expect(saved).toHaveText('项目已保存');
  await page.keyboard.press('F5');
  await expect(page.locator('.refresh-summary')).toContainText('新发现：0');
  await page.getByRole('button', { name: '取消，保留原计划', exact: true }).click();
  pass('移出画布的文件，刷新后不会自动回到画布');

  // Dragging a folder in works with a project open too.
  const dropData = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.items.add(new File(['x'], '不是真实路径.txt'));
    return data;
  });
  await page.dispatchEvent('main.workspace', 'dragover', { dataTransfer: dropData });
  await expect(page.getByTestId('welcome-drop')).toBeVisible();
  await page.dispatchEvent('main.workspace', 'drop', { dataTransfer: dropData });
  await expect(page.getByTestId('welcome-drop')).toHaveCount(0);
  await expect(toast).toContainText('没有读到文件夹位置');
  await clearToast();
  pass('已打开项目时也可以拖入文件夹');

  // The folder that used to leave the program unable to save or close.
  const opening = Date.now();
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await page
    .getByRole('menu', { name: '打开', exact: true })
    .getByRole('menuitem', { name: '整理下载' })
    .click();
  await expect(status).toContainText('共 5000 个文件', { timeout: 120000 });
  console.log(`打开 ${huge} 项的文件夹用时 ${((Date.now() - opening) / 1000).toFixed(1)} 秒`);
  await expect(toast).toContainText('另有 3 项未加入');
  await expect(saved).toHaveText('项目已保存', { timeout: 60000 });
  await page.screenshot({ path: path.join(shots, '01-超大文件夹.png') });
  await clearToast();
  // Saving still works, because the page and the main process agree on what is open.
  await page.keyboard.press('Control+s');
  await expect(saved).toHaveText('项目已保存', { timeout: 60000 });
  const panel = Date.now();
  await more('原始文件栏');
  await expect(page.locator('[data-testid="source-row"][data-name="还有 3 项未显示"]')).toBeVisible(
    { timeout: 60000 },
  );
  console.log(`打开 5000 行的原始文件栏用时 ${((Date.now() - panel) / 1000).toFixed(1)} 秒`);
  await page.getByTitle('收起文件栏').click();
  pass('超过 5000 项的文件夹可以打开：加入最近修改的 5000 项，并说明其余的，保存正常');

  // Opening the same folder comes back to its project, from the dialog as well.
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await page
    .getByRole('menu', { name: '打开', exact: true })
    .getByRole('menuitem', { name: '选择文件夹…' })
    .click();
  await expect(card('计划.txt')).toBeVisible({ timeout: 60000 });
  await expect(toast).toContainText('上次的项目');
  await clearToast();
  await expect(saved).toHaveText('项目已保存', { timeout: 60000 });
  const rootRecords = await page.evaluate(async () => (await window.fileCanvas.projects()).data);
  expect(rootRecords.filter((r) => r.name === '资料')).toHaveLength(1);
  pass('用“选择文件夹”再次打开同一个文件夹，回到它的项目，不会多出一份');

  // Forgetting a project keeps its files.
  await more('已保存项目');
  const dialog = page.getByRole('dialog', { name: '我的整理项目' });
  await expect(dialog.locator('.project-row').filter({ hasText: '资料' })).toContainText(
    '正在打开',
  );
  await dialog.getByRole('button', { name: '删除项目记录 下载', exact: true }).click();
  await dialog.getByRole('button', { name: '确定删除记录', exact: true }).click();
  await expect(toast).toContainText('文件夹和文件没有改动');
  await clearToast();
  expect((await fs.readdir(downloads)).length).toBe(huge);
  await page.keyboard.press('Escape');
  pass('可以删除项目记录，文件夹和文件不受影响');

  // Sample copies do not pile up or crowd out real projects.
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.fileCanvas.openDemo(6));
    await page.waitForTimeout(50);
  }
  const records = await page.evaluate(async () => (await window.fileCanvas.projects()).data);
  expect(records.filter((r) => r.demo)).toHaveLength(3);
  expect(await fs.readdir(path.join(data, 'demo-runs'))).toHaveLength(3);
  await page.reload();
  await expect(status).toContainText('个文件');
  await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
  await expect(
    page
      .getByRole('menu', { name: '打开', exact: true })
      .getByRole('menuitem', { name: /整理演练/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  pass('示例副本最多保留 3 份，并且不占“最近项目”');

  // About.
  await more('使用说明');
  await expect(page.getByTestId('app-about')).toContainText('FileCanvas 0.');
  await page.getByRole('button', { name: '打开日志文件夹', exact: true }).click();
  await page.keyboard.press('Escape');
  pass('使用说明里能看到版本和数据位置，并能打开日志文件夹');

  // The page can reload itself (the error screen's button does), and can go nowhere else.
  const reloaded = page.waitForEvent('load');
  await page.evaluate(() => void setTimeout(() => location.reload(), 0));
  await reloaded;
  await expect(status).toContainText('个文件');
  const where = await page.evaluate(async () => {
    location.href = 'https://example.com/';
    await new Promise((resolve) => setTimeout(resolve, 500));
    return location.protocol;
  });
  expect(where).toBe('file:');
  pass('页面可以重新加载自身，但不能跳转到其他地址');

  // A save that keeps failing asks, rather than trapping the user in an open window.
  await app.evaluate(({ ipcMain, dialog }) => {
    ipcMain.removeHandler('fc:save');
    ipcMain.handle('fc:save', async () => ({ ok: false, error: '模拟保存失败' }));
    globalThis.closeAsked = 0;
    dialog.showMessageBox = async (_window, options) => {
      globalThis.closeAsked++;
      globalThis.closeMessage = options.message;
      return { response: globalThis.closeAsked === 1 ? 0 : 1 };
    };
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(() => app.evaluate(() => globalThis.closeAsked), { timeout: 15000 }).toBe(1);
  expect(await app.evaluate(() => globalThis.closeMessage)).toBe('最后一次保存失败');
  // “Stay” keeps the window; asking again and choosing to close really closes it.
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const gone = exited(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await gone;
  pass('保存失败时关闭窗口会询问，可以留下，也可以放弃并关闭，不会关不掉');

  // Size and place are remembered.
  ({ app, page } = await launch());
  page.on('pageerror', (error) => errors.push(error.message));
  const windowBounds = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const restart = async () => {
    const closed = exited(app);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    ({ app, page } = await launch());
    page.on('pageerror', (error) => errors.push(error.message));
  };
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1111, height: 744 }),
  );
  await restart();
  // Display scaling rounds a new window's size by a few pixels (at 150%, 1112 becomes 1114) …
  const reopened = await windowBounds();
  expect(reopened).toMatchObject({ x: 40, y: 40 });
  expect(Math.abs(reopened.width - 1111)).toBeLessThanOrEqual(4);
  expect(Math.abs(reopened.height - 744)).toBeLessThanOrEqual(4);
  // … once: it must not grow a little with every start.
  await restart();
  expect(await windowBounds()).toEqual(reopened);
  pass('窗口大小和位置在重启后保留，多次重启不会逐渐变大');

  expect(errors).toEqual([]);
  const closed = exited(app);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;

  // A crashed page offers a reload and comes back to the same project (see crash-reload-main.cjs).
  const crashData = path.join(base, '崩溃检查数据');
  await fs.mkdir(crashData);
  const crashReport = path.join(base, 'crash-report.json');
  const crashEnv = {
    ...env,
    FILECANVAS_TEST_DATA: crashData,
    FILECANVAS_CRASH_REPORT: crashReport,
  };
  spawnSync(electronPath, [path.resolve('02_测试/交互测试/crash-reload-main.cjs')], {
    env: crashEnv,
    timeout: 90000,
  });
  const crash = JSON.parse(await fs.readFile(crashReport, 'utf8'));
  expect(crash.error).toBeUndefined();
  expect(crash.crashed).toBe(true);
  expect(crash.asked).toBe(1);
  expect(crash.message).toBe('界面意外退出了');
  expect(crash.after).toBe(crash.before);
  expect(await fs.readFile(path.join(crashData, 'logs', 'filecanvas.log'), 'utf8')).toContain(
    'render-process-gone',
  );
  pass('界面进程崩溃后提示重新加载，回到同一个项目，并写入本机日志');
  console.log('Maturity desktop checks passed.');
} catch (error) {
  await page.screenshot({ path: path.join(shots, 'failure.png') }).catch(() => {});
  await app.close().catch(() => {});
  throw error;
} finally {
  await fs.rm(base, { recursive: true, force: true }).catch(() => {});
}
