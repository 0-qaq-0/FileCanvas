import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, safeStorage } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { constants, readFileSync, writeFileSync } from 'node:fs';
import {
  createProject,
  importPaths,
  importSummary,
  inside,
  listDirectory,
  readEntry,
  noLinks,
  readableError,
  searchFiles,
  validateAuthorized,
} from './filesystem';
import { ProjectStorage } from './storage';
import { RulesStorage } from './rules-storage';
import { PreferencesStorage } from './preferences-storage';
import { createSampleFolder } from './demo-samples';
import { importEntries, setGridColumns, workspace } from '../src/domain/workspace';
import { markdownPlan } from '../src/domain/plan-report';
import { comparisonImageName } from '../src/domain/comparison';
import type { KnownFolder, Project } from '../src/domain/types';
import { AiService } from './ai';
import { readContent } from './content';
import {
  availableGroupFiles,
  copyGroupFiles,
  resolveGroupFiles,
  writeGroupZip,
} from './group-archive';
import { DiskOperations } from './disk-operations';
import { createFlowDemo } from './flow-demo';
import { prepareRefresh } from './refresh';
import { reopenSaved } from './reopen';
import { Log } from './log';
import { fitWindow, MIN_SIZE } from './window-state';

let mainWindow: BrowserWindow;
let activeRoot: string | null = null;
let activeProjectId: string | null = null;
let storage: ProjectStorage;
let rules: RulesStorage;
let preferences: PreferencesStorage;
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
const log = new Log(path.join(app.getPath('userData'), 'logs'));
process.on('uncaughtException', (error) => log.write('error', 'uncaughtException', error));
process.on('unhandledRejection', (reason) => log.write('error', 'unhandledRejection', reason));
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
      log.write('warn', channel, error);
      return { ok: false, error: readableError(error) };
    }
  });
}
function root(): string {
  if (!activeRoot) throw new Error('请先打开一个本地文件夹。');
  return activeRoot;
}
async function activate(project: Project): Promise<Project> {
  if (fileOperation || disk.isBusy()) throw new Error('文件整理进行中，请完成后再切换项目。');
  // Root can disappear after saving; the user still needs to inspect the virtual plan.
  validateAuthorized(project, project.rootPath);
  if (inside(project.rootPath, app.getPath('userData')))
    throw new Error('请选择更具体的文件夹，项目根目录不能包含 FileCanvas 自身的数据目录。');
  // The switch comes last. If anything above fails the page keeps showing the current project,
  // and that project has to remain the one that can be saved.
  const reconciled = await disk.reconcile(project);
  if (reconciled !== project) {
    await storage.save(reconciled);
    await disk.acknowledge(project.rootPath, project.id);
  }
  activeRoot = project.rootPath;
  activeProjectId = project.id;
  ai.reset(activeRoot);
  return reconciled;
}
// Window size and place are remembered between runs, except in automated tests.
const remembersWindow =
  (!e2e && process.env.FILECANVAS_TEST_PROFILE !== '1') ||
  process.env.FILECANVAS_TEST_WINDOW_STATE === '1';
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  let saved: unknown = null;
  if (remembersWindow)
    try {
      saved = JSON.parse(readFileSync(windowStateFile(), 'utf8'));
    } catch {}
  const primary = screen.getPrimaryDisplay().workArea;
  return fitWindow(saved, [
    primary,
    ...screen
      .getAllDisplays()
      .map((d) => d.workArea)
      .filter((r) => r.x !== primary.x || r.y !== primary.y),
  ]);
}
function saveWindowState() {
  if (!remembersWindow || mainWindow.isDestroyed()) return;
  try {
    writeFileSync(
      windowStateFile(),
      JSON.stringify({ ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }),
    );
  } catch (error) {
    log.write('warn', 'window-state', error);
  }
}
// Types handed to the system's default program. Programs and scripts (.exe, .bat, .lnk…) are
// never started from here: scripts open as text below, and the rest go through Explorer.
const DEFAULT_APP_FILE =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|log|xml|pdf|rtf|epub|docx?|xlsx?|pptx?|odt|ods|odp|wps|et|dps|png|jpe?g|gif|webp|bmp|tiff?|heic|ico|psd|ai|mp3|wav|flac|m4a|aac|ogg|wma|mp4|mov|mkv|avi|wmv|webm|m4v|zip|rar|7z|tar|gz)$/i;
const TEXT_EDITOR_FILE =
  /\.(py|[cm]?[jt]sx?|ps1|sh|cmd|bat|vbs|c|cpp|h|hpp|rs|go|java|html|css|svg|sql)$/i;
// Sample copies kept per computer. Older ones are created again in a click, so they are cleared.
const DEMO_COPIES_KEPT = 3;
async function removeProject(id: string, rootPath: string, demo: boolean) {
  await storage.remove(id);
  if (!demo) return;
  // A sample copy is FileCanvas' own data: its generated folder goes with its record.
  const runs = path.join(app.getPath('userData'), 'demo-runs');
  const run = path.dirname(rootPath);
  if (path.dirname(run) === runs) await fs.rm(run, { recursive: true, force: true });
}
app.whenReady().then(async () => {
  if (!hasInstanceLock) return;
  storage = new ProjectStorage(path.join(app.getPath('userData'), 'projects'));
  rules = new RulesStorage(app.getPath('userData'));
  preferences = new PreferencesStorage(app.getPath('userData'));
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
  disk = new DiskOperations(path.join(app.getPath('userData'), 'operations'), (progress) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('fc:operation-progress', progress);
  });
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
  const windowState = loadWindowState();
  mainWindow = new BrowserWindow({
    ...(windowState.x === undefined ? {} : { x: windowState.x, y: windowState.y }),
    width: windowState.width,
    height: windowState.height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    show: false,
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
  // Nothing may take the window elsewhere; only reloading the page itself (the error screen's
  // 重新加载) goes through.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  // A crashed page is offered a reload: every canvas change is saved as it happens, and an
  // unfinished disk operation is recovered from its journal, so nothing depends on the page.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.write('error', 'render-process-gone', details.reason);
    if (closing || details.reason === 'clean-exit') return;
    rendererReady = false;
    closePending = false;
    void dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: 'FileCanvas',
        message: '界面意外退出了',
        detail: '整理计划已自动保存，本地文件不受影响。可以重新加载后继续。',
        buttons: ['重新加载', '退出程序'],
        defaultId: 0,
        cancelId: 0,
      })
      .then(({ response }) => {
        if (response === 0) mainWindow.webContents.reload();
        else {
          closing = true;
          app.quit();
        }
      });
  });
  mainWindow.on('unresponsive', () => log.write('warn', 'window unresponsive'));
  // Every way of choosing a root (dialog, common place, dropped folder) goes through the same
  // checks, and a folder that already has a saved project opens that project again (see
  // reopenSaved): opening it neither hides earlier work, loses the undo record nor piles up projects.
  async function openChosenRoot(chosen: string): Promise<Project> {
    if (fileOperation) throw new Error('文件整理进行中，请完成后再切换目录。');
    if (chosen.startsWith('\\\\') || (await fs.lstat(chosen)).isSymbolicLink())
      throw new Error('暂不支持网络路径、符号链接或目录联接。');
    const canonical = await fs.realpath(chosen);
    if (inside(canonical, app.getPath('userData')))
      throw new Error(
        '请选择更具体的文件夹（如“下载”）。整理根目录不能包含 FileCanvas 自身的数据目录。',
      );
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error('请选择文件夹。');
    await fs.readdir(canonical);
    const reopened = await reopenSaved(storage, canonical, activate);
    if (reopened) return reopened;
    const project = createProject(canonical);
    await storage.save(project);
    return activate(project);
  }
  // Places offered on the welcome page and in the 打开 menu. Chat apps' storage (WeChat, QQ) is
  // left out on purpose: moving files there breaks the links inside the chat history.
  async function knownFolders(): Promise<KnownFolder[]> {
    let base: string | null = null;
    if (e2e && process.env.FILECANVAS_TEST_KNOWN) {
      base = path.resolve(process.env.FILECANVAS_TEST_KNOWN);
      if (!base.startsWith(path.join(os.tmpdir(), 'filecanvas-e2e-')))
        throw new Error('测试位置目录不合法。');
    }
    const places: KnownFolder[] = [
      {
        id: 'downloads',
        label: '下载',
        path: base ? path.join(base, '下载') : app.getPath('downloads'),
      },
      {
        id: 'desktop',
        label: '桌面',
        path: base ? path.join(base, '桌面') : app.getPath('desktop'),
      },
    ];
    const found: KnownFolder[] = [];
    for (const place of places)
      try {
        if ((await fs.stat(place.path)).isDirectory()) found.push(place);
      } catch {}
    return found;
  }
  handle('fc:known-folders', () => knownFolders());
  // `columns` lays out cards that a reopened project gains from the folder, as wide as the canvas.
  handle('fc:open-known', async (id: unknown, columns?: unknown) => {
    const place = (await knownFolders()).find((p) => p.id === id);
    if (!place) throw new Error('没有找到这个位置，请用“选择文件夹”打开。');
    if (typeof columns === 'number') setGridColumns(columns);
    return openChosenRoot(place.path);
  });
  // The path comes from the preload, which only converts a File the user actually dropped.
  handle('fc:open-dropped', async (chosen: unknown, columns?: unknown) => {
    if (typeof chosen !== 'string' || !chosen || !path.isAbsolute(chosen))
      throw new Error('没有读到文件夹位置，请从资源管理器拖入一个文件夹。');
    if (!(await fs.stat(chosen)).isDirectory()) throw new Error('请拖入文件夹，而不是单个文件。');
    if (typeof columns === 'number') setGridColumns(columns);
    return openChosenRoot(chosen);
  });
  // Saves the visible before/after card as a PNG: the page passes the card's box, nothing else.
  handle('fc:save-image', async (rect: unknown) => {
    const box = rect as { x: number; y: number; width: number; height: number } | null;
    const [width, height] = mainWindow.getContentSize();
    if (
      !box ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.width < 10 ||
      box.height < 10 ||
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > width + 1 ||
      box.y + box.height > height + 1
    )
      throw new Error('对比图不在窗口可见范围内，请放大窗口后重试。');
    const image = await mainWindow.webContents.capturePage({
      x: Math.floor(box.x),
      y: Math.floor(box.y),
      width: Math.ceil(box.width),
      height: Math.ceil(box.height),
    });
    const name = comparisonImageName(new Date());
    let target: string;
    if (e2e) {
      const directory = path.join(app.getPath('userData'), 'exports');
      await fs.mkdir(directory, { recursive: true });
      target = path.join(directory, name);
    } else {
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '保存整理前后对比图',
        defaultPath: path.join(app.getPath('pictures'), name),
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      });
      if (result.canceled || !result.filePath) return null;
      target = result.filePath;
    }
    await fs.writeFile(target, image.toPNG());
    lastExport = await fs.realpath(target);
    lastExportDirectory = path.dirname(lastExport);
    return lastExport;
  });
  handle('fc:open-root', async (columns?: unknown) => {
    if (fileOperation) throw new Error('文件整理进行中，请完成后再切换目录。');
    let chosen: string | undefined;
    if (e2e && process.env.FILECANVAS_TEST_ROOT) {
      chosen = path.resolve(process.env.FILECANVAS_TEST_ROOT);
      if (!chosen.startsWith(path.join(os.tmpdir(), 'filecanvas-e2e-')))
        throw new Error('测试根目录不合法。');
    } else {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择要整理的本地文件夹',
        properties: ['openDirectory'],
      });
      chosen = result.canceled ? undefined : result.filePaths[0];
    }
    if (!chosen) return null;
    if (typeof columns === 'number') setGridColumns(columns);
    return openChosenRoot(chosen);
  });
  handle('fc:list', (directory) => listDirectory(root(), directory, { cap: true }));
  handle('fc:content', (filename) => readContent(root(), filename));
  handle('fc:file-ai-access', (enabled) => ai.fileAccess(root(), enabled));
  handle('fc:file-explain', (project, id, refresh) => ai.explain(root(), project, id, refresh));
  handle('fc:file-followup', (project, id, question) => ai.followup(root(), project, id, question));
  handle('fc:open-file', async (filename) => {
    const entry = await readEntry(root(), filename);
    if (entry.kind !== 'file') throw new Error('请选择一个文件。');
    const codeFile = TEXT_EDITOR_FILE.test(entry.name);
    if (!DEFAULT_APP_FILE.test(entry.name) && !codeFile)
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
  handle('fc:reveal-file', async (filename) => {
    // readEntry keeps the request inside the project root and refuses links.
    const entry = await readEntry(root(), filename);
    if (!e2e) shell.showItemInFolder(entry.path);
    return true;
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
  handle('fc:import', (paths, room) =>
    importSummary(root(), paths, typeof room === 'number' ? { room } : {}),
  );
  handle('fc:save', (project: Project) => {
    if (fileOperation || disk.isBusy()) throw new Error('正在执行磁盘整理，请完成后再保存或关闭。');
    validateAuthorized(project, root());
    return storage.save(project);
  });
  handle('fc:projects', () => storage.list());
  handle('fc:delete-project', async (id: string) => {
    if (fileOperation || disk.isBusy()) throw new Error('文件整理进行中，请完成后再操作。');
    if (id === activeProjectId) throw new Error('这个项目正在打开，请先打开别的文件夹再删除记录。');
    const project = await storage.load(id);
    if ((await disk.status(project.rootPath, id).catch(() => null))?.needsRecovery)
      throw new Error('这个项目还有未完成的文件整理，请先打开它并恢复。');
    await removeProject(id, project.rootPath, !!project.demo);
    return true;
  });
  handle('fc:app-info', () => ({ version: app.getVersion(), dataPath: app.getPath('userData') }));
  handle('fc:reveal-logs', async () => {
    await fs.mkdir(log.directory, { recursive: true });
    if (e2e) return true;
    const error = await shell.openPath(log.directory);
    if (error) throw new Error('无法打开日志文件夹。');
    return true;
  });
  handle('fc:rules-load', () => rules.load());
  handle('fc:rules-save', (list) => rules.save(list));
  handle('fc:prefs-load', () => preferences.load());
  handle('fc:prefs-save', (value) => preferences.save(value));
  handle('fc:load', async (id) => activate(await storage.load(id)));
  handle('fc:restore', async () => {
    const project = await storage.last();
    return project ? activate(project) : null;
  });
  handle('fc:preview', (project) => disk.preview(root(), project));
  handle('fc:refresh', (project) => prepareRefresh(root(), project));
  handle('fc:operation-status', (projectId) => disk.status(root(), projectId));
  handle('fc:disk-undo-available', (projectId) => disk.available(root(), projectId));
  handle('fc:apply', (project: Project, planId: string) =>
    diskTask(async () => {
      if (typeof planId !== 'string' || !planId) throw new Error('请先检查整理计划再确认应用。');
      const operationRoot = root();
      await storage.flush();
      const result = await disk.apply(operationRoot, project, planId);
      try {
        await storage.save(result.project);
        await disk.acknowledge(operationRoot, project.id);
      } catch {
        throw new Error(
          '文件已移动并核验，但项目记录保存未完成。重新打开项目会从操作日志补回记录；也可恢复上次文件移动。',
        );
      }
      ai.invalidate(root());
      return result;
    }),
  );
  handle('fc:undo-disk', (projectId, current?: Project) =>
    diskTask(async () => {
      await storage.flush();
      if (current) {
        validateAuthorized(current, root());
        if (current.id !== projectId) throw new Error('只能恢复当前项目的磁盘整理。');
      }
      const project = await disk.undo(root(), projectId, current?.canvasGroups);
      await storage.save(project);
      await disk.acknowledge(root(), projectId);
      ai.invalidate(root());
      return project;
    }),
  );
  handle('fc:open-demo', async (columns?: number) => {
    if (fileOperation) throw new Error('请等待文件整理完成。');
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
    // Lay the cards out as wide as the window's canvas, like folders opened in the window.
    if (typeof columns === 'number') setGridColumns(columns);
    const populated = importEntries(workspace(project), entries, null).project;
    await storage.save(populated);
    const opened = await activate(populated);
    // Trying the sample repeatedly must not fill the disk and the project list with copies.
    const copies = (await storage.list()).filter((r) => r.demo && r.id !== opened.id);
    for (const old of copies.slice(DEMO_COPIES_KEPT - 1))
      await removeProject(old.id, old.rootPath, true).catch((error) =>
        log.write('warn', 'remove old demo', error),
      );
    return opened;
  });
  handle('fc:group-files', async (files: string[]) =>
    (await resolveGroupFiles(root(), files)).map((entry) => entry.path),
  );
  handle('fc:missing-group-files', async (files: string[]) =>
    files.length ? (await availableGroupFiles(root(), files)).missing : [],
  );
  const authorizedGroup = (project: Project, id: string) => {
    const projectRoot = root();
    validateAuthorized(project, projectRoot);
    const group = project.canvasGroups?.find((item) => item.id === id);
    if (!group?.files.length) throw new Error('请先向文件集添加文件。');
    return { projectRoot, group };
  };
  handle('fc:copy-group', (project: Project, id: string) =>
    diskTask(async () => {
      const { projectRoot, group } = authorizedGroup(project, id);
      const result = await dialog.showOpenDialog(mainWindow, {
        title: `把“${group.name}”复制到…`,
        buttonLabel: '复制到这里',
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return copyGroupFiles(projectRoot, group.files, result.filePaths[0], group.name);
    }),
  );
  handle('fc:export-group', (project: Project, id: string) =>
    diskTask(async () => {
      const { projectRoot, group } = authorizedGroup(project, id);
      const result = await dialog.showSaveDialog(mainWindow, {
        title: `把“${group.name}”打包为 ZIP`,
        defaultPath: `${group.name}.zip`,
        filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return null;
      const destination = /\.zip$/i.test(result.filePath)
        ? result.filePath
        : `${result.filePath}.zip`;
      return writeGroupZip(projectRoot, group.files, destination);
    }),
  );
  handle('fc:export-plan', async (project: Project) => {
    const preview = await disk.preview(root(), project);
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
  function closeNow() {
    closing = true;
    if (!mainWindow.isDestroyed()) mainWindow.close();
  }
  ipcMain.on('fc:finish-close', (event, saved, saveFailed) => {
    if (
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame
    )
      return;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    if (saved !== true) {
      closePending = false;
      // A save that keeps failing must never leave the user with a window that will not close.
      if (saveFailed === true)
        void dialog
          .showMessageBox(mainWindow, {
            type: 'warning',
            title: 'FileCanvas',
            message: '最后一次保存失败',
            detail: '现在关闭，画布上最近的修改可能丢失。本地文件不受影响。',
            buttons: ['留在程序', '不保存，直接关闭'],
            defaultId: 0,
            cancelId: 0,
          })
          .then(({ response }) => {
            if (response === 1) closeNow();
          });
      return;
    }
    Promise.all([storage.flush(), preferences.flush()])
      .then(closeNow)
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
          .finally(closeNow);
        return;
      }
      if (!closePending) {
        closePending = true;
        mainWindow.webContents.send('fc:close-requested');
        // A frozen page never answers. Unless files are being moved, close without it: each
        // change was already saved when it was made.
        closeTimer = setTimeout(() => {
          closeTimer = null;
          closePending = false;
          if (fileOperation || disk.isBusy()) return;
          log.write('warn', 'page did not answer the close request');
          storage
            .flush()
            .catch(() => {})
            .finally(closeNow);
        }, 8000);
      }
      return;
    }
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    saveWindowState();
  });
  try {
    await mainWindow.loadURL(devUrl ?? entryUrl);
    if (!closing && !mainWindow.isDestroyed()) {
      if (windowState.maximized) mainWindow.maximize();
      mainWindow.show();
      if (devUrl) {
        mainWindow.setTitle('FileCanvas · 开发体验 · 展开式整理');
        mainWindow.focus();
      }
    }
  } catch (error) {
    if (!closing) {
      log.write('error', 'startup failed', error);
      dialog.showErrorBox('FileCanvas 启动失败', readableError(error));
      closing = true;
      app.quit();
    }
  }
});
let closing = false;
let closePending = false;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let rendererReady = false;
app.on('window-all-closed', () => app.quit());
