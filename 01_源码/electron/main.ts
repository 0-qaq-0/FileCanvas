import { app, BrowserWindow, dialog, ipcMain, Menu, shell, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  createProject,
  generatePreview,
  importPaths,
  inside,
  listDirectory,
  readEntry,
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
import { AiService } from './ai';
import { readContent } from './content';
import { DiskOperations } from './disk-operations';
import { createFlowDemo } from './flow-demo';

let mainWindow: BrowserWindow;
let activeRoot: string | null = null;
let storage: ProjectStorage;
let ai: AiService;
let disk: DiskOperations;
let fileOperation: Promise<unknown> | null = null;
function diskTask<T>(task: () => Promise<T>): Promise<T> {
  if (fileOperation) throw new Error('正在执行磁盘整理，请稍候。');
  const pending = task();
  fileOperation = pending;
  return pending.finally(() => {
    fileOperation = null;
  });
}
let lastExport: string | null = null;
let lastExportDirectory: string | null = null;
const devUrl =
  !app.isPackaged && process.env.FILECANVAS_DEV_URL === 'http://127.0.0.1:5173'
    ? process.env.FILECANVAS_DEV_URL
    : undefined;
const e2e = !app.isPackaged && process.env.FILECANVAS_E2E === '1';
app.setName('FileCanvas');
app.setPath(
  'userData',
  path.join(app.getPath('appData'), devUrl ? 'FileCanvas-Development' : 'FileCanvas'),
);
if ((e2e || process.env.FILECANVAS_TEST_PROFILE === '1') && process.env.FILECANVAS_TEST_DATA) {
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
  ai.reset(activeRoot);
  return project;
}
app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  storage = new ProjectStorage(path.join(app.getPath('userData'), 'projects'));
  if (devUrl && !e2e && process.env.FILECANVAS_TEST_PROFILE !== '1') {
    const existing = path.join(app.getPath('appData'), 'FileCanvas', 'ai-settings.json');
    try {
      await noLinks(path.dirname(existing), existing);
      await fs.mkdir(app.getPath('userData'), { recursive: true });
      await fs.copyFile(
        existing,
        path.join(app.getPath('userData'), 'ai-settings.json'),
        constants.COPYFILE_EXCL,
      );
    } catch (error) {
      if (!['ENOENT', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  disk = new DiskOperations(path.join(app.getPath('userData'), 'operations'));
  if (devUrl && !e2e && !(await storage.list()).length)
    await storage.save(await createFlowDemo(app.getPath('userData')));
  ai = new AiService(app.getPath('userData'), {
    encrypt(value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密不可用，未保存密钥。');
      return safeStorage.encryptString(value).toString('base64');
    },
    decrypt(value) {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: '#f5f6f8',
    icon: path.join(__dirname, '../../01_源码/assets/icon.ico'),
    title: devUrl ? 'FileCanvas · 开发体验 · 展开式整理' : 'FileCanvas · 文件画布与 AI 助手',
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
  handle('fc:content', (filename) => readContent(root(), filename));
  handle('fc:file-ai-access', (enabled) => ai.fileAccess(root(), enabled));
  handle('fc:file-explain', (project, id, refresh) => ai.explain(root(), project, id, refresh));
  handle('fc:file-followup', (project, id, question) => ai.followup(root(), project, id, question));
  handle('fc:open-file', async (filename) => {
    const entry = await readEntry(root(), filename);
    if (entry.kind !== 'file') throw new Error('请选择一个文件。');
    const safeDocument =
      /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|log|xml|pdf|docx?|xlsx?|pptx?|png|jpe?g|gif|webp|bmp|mp3|wav|flac|mp4|mov|mkv)$/i.test(
        entry.name,
      );
    const codeFile =
      /\.(py|[cm]?[jt]sx?|ps1|sh|cmd|bat|vbs|c|cpp|h|hpp|rs|go|java|html|css|svg|sql)$/i.test(
        entry.name,
      );
    if (!safeDocument && !codeFile)
      throw new Error('此格式暂不提供直接打开，请在资源管理器中选择合适的查看程序。');
    const method = codeFile ? 'text-editor' : 'system-default';
    if (e2e) return { path: entry.path, opened: false, method };
    if (codeFile)
      await new Promise<void>((resolve, reject) => {
        const child = spawn('notepad.exe', [entry.path], {
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
          shell: false,
        });
        child.once('spawn', () => {
          child.unref();
          resolve();
        });
        child.once('error', reject);
      });
    else {
      const error = await shell.openPath(entry.path);
      if (error) throw new Error('系统应用未能打开此文件。');
    }
    return { path: entry.path, opened: true, method };
  });
  handle('fc:ai-settings', () => ai.settings());
  handle('fc:ai-save', (settings) => ai.save(settings));
  handle('fc:ai-test', () => ai.test());
  handle('fc:ai-index', () => ai.build(root()));
  handle('fc:ai-index-status', () => ai.indexStatus(root()));
  handle('fc:ai-prepare', (project, ids, question) => ai.prepare(root(), project, ids, question));
  handle('fc:ai-ask', (project, ids, question, organize, context, history) =>
    ai.ask(root(), project, ids, question, organize, context, history),
  );
  handle('fc:search', (query) => searchFiles(root(), query));
  handle('fc:import', (paths) => importPaths(root(), paths));
  handle('fc:save', (project: Project) => {
    if (fileOperation || disk.isBusy()) throw new Error('正在执行磁盘整理，请完成后再保存或关闭。');
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
  handle('fc:disk-undo-available', (projectId) => disk.available(root(), projectId));
  handle('fc:apply', (project: Project) =>
    diskTask(async () => {
      await storage.flush();
      const result = await disk.apply(root(), project);
      try {
        await storage.save(result.project);
      } catch {
        throw new Error('文件已经移动，但项目记录保存失败。请使用“撤销上次磁盘整理”恢复原路径。');
      }
      ai.invalidate(root());
      return result;
    }),
  );
  handle('fc:undo-disk', (projectId) =>
    diskTask(async () => {
      await storage.flush();
      const project = await disk.undo(root(), projectId);
      await storage.save(project);
      ai.invalidate(root());
      return project;
    }),
  );
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
    if (!closing && !mainWindow.isDestroyed()) {
      mainWindow.show();
      if (devUrl) {
        mainWindow.setTitle('FileCanvas · 开发体验 · 展开式整理');
        mainWindow.focus();
      }
    }
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
