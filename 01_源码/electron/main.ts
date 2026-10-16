import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  createProject,
  generatePreview,
  importPaths,
  inside,
  listDirectory,
  noLinks,
  readableError,
  searchFiles,
  validateAuthorized,
} from './filesystem';
import { ProjectStorage } from './storage';
import { createSampleFolder } from './demo-samples';
import { importEntries, workspace } from '../src/domain/workspace';
import { markdownPlan } from '../src/domain/plan-report';
import type { Project } from '../src/domain/types';

let mainWindow: BrowserWindow;
let activeRoot: string | null = null;
let storage: ProjectStorage;
let lastExport: string | null = null;
let lastExportDirectory: string | null = null;
const devUrl =
  !app.isPackaged && process.env.FILECANVAS_DEV_URL === 'http://127.0.0.1:5173'
    ? process.env.FILECANVAS_DEV_URL
    : undefined;
const e2e = !app.isPackaged && process.env.FILECANVAS_E2E === '1';
app.setName('FileCanvas');
app.setPath('userData', path.join(app.getPath('appData'), 'FileCanvas'));
if (e2e && process.env.FILECANVAS_TEST_DATA) {
  const dir = path.resolve(process.env.FILECANVAS_TEST_DATA);
  if (!dir.startsWith(path.join(os.tmpdir(), 'filecanvas-e2e-')))
    throw new Error('测试数据目录必须使用专用临时目录。');
  app.setPath('userData', dir);
}
const entryUrl = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});
function handle(channel: string, fn: (...args: any[]) => unknown): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame ||
        !(
          event.senderFrame.url === entryUrl ||
          (devUrl && new URL(event.senderFrame.url).origin === devUrl)
        )
      )
        throw new Error('请求来源不受信任。');
      return { ok: true, data: await fn(...args) };
    } catch (error) {
      return { ok: false, error: readableError(error) };
    }
  });
}
function root(): string {
  if (!activeRoot) throw new Error('请先打开一个本地文件夹。');
  return activeRoot;
}
async function activate(project: Project): Promise<Project> {
  // Root can disappear after saving; the user still needs to inspect the virtual plan.
  validateAuthorized(project, project.rootPath);
  if (inside(project.rootPath, app.getPath('userData')))
    throw new Error('请选择更具体的文件夹，项目根目录不能包含 FileCanvas 自身的数据目录。');
  activeRoot = project.rootPath;
  return project;
}
app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  storage = new ProjectStorage(path.join(app.getPath('userData'), 'projects'));
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#f5f6f8',
    icon: path.join(__dirname, '../../01_源码/assets/icon.ico'),
    title: 'FileCanvas · 虚拟文件整理',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  handle('fc:open-root', async () => {
    let chosen: string | undefined;
    if (e2e && process.env.FILECANVAS_TEST_ROOT) {
      chosen = path.resolve(process.env.FILECANVAS_TEST_ROOT);
      if (!chosen.startsWith(path.join(os.tmpdir(), 'filecanvas-e2e-')))
        throw new Error('测试根目录不合法。');
    } else {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择要虚拟整理的文件夹（阶段一只读）',
        properties: ['openDirectory'],
      });
      chosen = result.canceled ? undefined : result.filePaths[0];
    }
    if (!chosen) return null;
    if (chosen.startsWith('\\\\') || (await fs.lstat(chosen)).isSymbolicLink())
      throw new Error('暂不支持网络路径、符号链接或目录联接。');
    const canonical = await fs.realpath(chosen);
    if (inside(canonical, app.getPath('userData')))
      throw new Error(
        '请选择更具体的文件夹（如“下载”）。整理根目录不能包含 FileCanvas 自身的数据目录。',
      );
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('请选择文件夹。');
    await fs.readdir(canonical);
    const project = createProject(canonical);
    await storage.save(project);
    return activate(project);
  });
  handle('fc:list', (directory) => listDirectory(root(), directory));
  handle('fc:search', (query) => searchFiles(root(), query));
  handle('fc:import', (paths) => importPaths(root(), paths));
  handle('fc:save', (project: Project) => {
    validateAuthorized(project, root());
    return storage.save(project);
  });
  handle('fc:projects', () => storage.list());
  handle('fc:load', async (id) => activate(await storage.load(id)));
  handle('fc:restore', async () => {
    const project = await storage.last();
    return project ? activate(project) : null;
  });
  handle('fc:preview', (project) => generatePreview(root(), project));
  handle('fc:open-demo', async () => {
    const owner = app.getPath('userData');
    const runDirectory = path.join(owner, 'demo-runs', randomUUID());
    await noLinks(owner, path.dirname(runDirectory));
    await fs.mkdir(runDirectory, { recursive: true });
    await noLinks(owner, runDirectory);
    const sampleRoot = path.join(runDirectory, '待整理示例');
    const manifest = await createSampleFolder(sampleRoot);
    await fs.writeFile(
      path.join(runDirectory, '样例清单.json'),
      JSON.stringify(manifest, null, 2),
      { encoding: 'utf8', flag: 'wx' },
    );
    // MSIX hosts may redirect AppData writes without exposing a symlink. Use the
    // resolved directory after creation for the same strict source boundary.
    const canonicalRoot = await fs.realpath(sampleRoot);
    const project = createProject(canonicalRoot);
    project.name = '内容项目 · 整理演练';
    project.demo = { scenario: 'content-project', fixtureVersion: 1 };
    const entries = await importPaths(
      canonicalRoot,
      (await listDirectory(canonicalRoot, canonicalRoot)).map((e) => e.path),
    );
    const populated = importEntries(workspace(project), entries, null).project;
    await storage.save(populated);
    return activate(populated);
  });
  handle('fc:export-plan', async (project: Project) => {
    const preview = await generatePreview(root(), project);
    const directory = path.join(app.getPath('userData'), 'exports');
    await noLinks(app.getPath('userData'), directory);
    await fs.mkdir(directory, { recursive: true });
    await noLinks(app.getPath('userData'), directory);
    const filename = path.join(directory, `FileCanvas-整理方案-${randomUUID()}.md`);
    await fs.writeFile(filename, markdownPlan(project, preview), { encoding: 'utf8', flag: 'wx' });
    lastExport = await fs.realpath(filename);
    lastExportDirectory = path.dirname(lastExport);
    return { path: lastExport, checkedAt: preview.checkedAt, preview };
  });
  handle('fc:reveal-export', async () => {
    if (!lastExport || !lastExportDirectory) throw new Error('请先导出一份整理方案。');
    await noLinks(lastExportDirectory, lastExport);
    if (!(await fs.stat(lastExport)).isFile()) throw new Error('导出文件已不存在。');
    shell.showItemInFolder(lastExport);
    return true;
  });
  handle('fc:reveal-root', async () => {
    const directory = root();
    await noLinks(directory, directory);
    if (!(await fs.stat(directory)).isDirectory()) throw new Error('原始文件夹已不可用。');
    const error = await shell.openPath(directory);
    if (error) throw new Error('无法在资源管理器中打开原始文件夹。');
    return true;
  });
  ipcMain.on('fc:finish-close', (event, saved) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      return;
    if (saved !== true) {
      closePending = false;
      return;
    }
    storage
      .flush()
      .then(() => {
        closing = true;
        mainWindow.close();
      })
      .catch(() => {
        closePending = false;
      });
  });
  ipcMain.on('fc:renderer-ready', (event) => {
    if (
      event.sender === mainWindow.webContents &&
      event.senderFrame === mainWindow.webContents.mainFrame
    )
      rendererReady = true;
  });
  mainWindow.on('close', (event) => {
    if (!closing && !mainWindow.webContents.isDestroyed() && !mainWindow.webContents.isCrashed()) {
      event.preventDefault();
      if (!rendererReady) {
        storage
          .flush()
          .catch(() => {})
          .finally(() => {
            closing = true;
            mainWindow.close();
          });
        return;
      }
      if (!closePending) {
        closePending = true;
        mainWindow.webContents.send('fc:close-requested');
      }
    }
  });
  try {
    await mainWindow.loadURL(devUrl ?? entryUrl);
  } catch (error) {
    if (!closing) {
      dialog.showErrorBox('FileCanvas 启动失败', readableError(error));
      closing = true;
      app.quit();
    }
  }
});
let closing = false;
let closePending = false;
let rendererReady = false;
app.on('window-all-closed', () => app.quit());
