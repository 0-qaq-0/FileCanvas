import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  createProject,
  generatePreview,
  importPaths,
  inside,
  listDirectory,
  readableError,
  searchFiles,
  validateAuthorized,
} from './filesystem';
import { ProjectStorage } from './storage';
import type { Project } from '../src/domain/types';

let mainWindow: BrowserWindow;
let activeRoot: string | null = null;
let storage: ProjectStorage;
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
