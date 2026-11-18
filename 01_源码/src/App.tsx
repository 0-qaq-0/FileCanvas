import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Save,
  Undo2,
  Redo2,
  ScanEye,
  ShieldCheck,
  Files,
  MoveRight,
  Pencil,
  X,
  LoaderCircle,
  Check,
  Info,
  Sparkles,
  PanelLeft,
  Layers3,
  Play,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  RefreshCw,
  AlertTriangle,
  Eye,
  ExternalLink,
  Expand,
  GraduationCap,
  SlidersHorizontal,
  Shapes,
  ChevronDown,
  Download,
  History,
  Monitor,
} from 'lucide-react';
import type {
  ApiResult,
  ImportSummary,
  KnownFolder,
  NodeMap,
  Preview,
  Project,
  ProjectRecord,
  Workspace,
  FileAdvice,
  OperationStatus,
  OperationProgress,
  RefreshReview,
} from './domain/types';
import {
  addFolder,
  commit,
  editCanvasGroups,
  uniqueGroupFiles,
  validateName,
  importEntries,
  moveNodes,
  redo,
  renameNode,
  undo,
  workspace,
  isDescendant,
  moveToNewFolder,
  preferredColumns,
  setGridColumns,
  hasPendingPlan,
  pendingNodes,
  MAX_NODES,
} from './domain/workspace';
import { columnsForWidth } from './domain/canvas-layout';
import { comparePlan } from './domain/comparison';
import { ReportDialog } from './components/ReportDialog';
import type { ApplyReport } from './components/ReportDialog';
import { Browser } from './components/Browser';
import { Canvas } from './components/ExpandedCanvas';
import { Modal, MoveDialog, PreviewDialog, ProjectsDialog } from './components/Dialogs';
import { HelpDialog } from './components/HelpDialog';
import { DraftDialog } from './components/DraftDialog';
import { BatchRenameDialog } from './components/BatchRenameDialog';
import { ContextMenu } from './components/ContextMenu';
import type { MenuItem } from './components/ContextMenu';
import { applyBatchRename } from './domain/batch-rename';
import { FileInspector } from './components/FileInspector';
import { applyFileAdvice } from './domain/file-advice';
import { AiPanel } from './components/AiPanel';
import { adoptAiPlan } from './domain/ai-plan';
import { buildClassificationDraft } from './domain/drafts';
import type { DraftMode } from './domain/drafts';
import { suggestFolderName, suggestRecipes } from './domain/recipes';
import { filterLayer, selectableMatches } from './domain/filter';
import { SuggestionBar } from './components/SuggestionBar';
import { RecoveryDialog, RefreshDialog } from './components/OperationDialogs';
import { Tutorial } from './components/Tutorial';
import { WelcomeArt } from './components/WelcomeArt';
import { readTutorialDone, writeTutorialDone } from './domain/tutorial';
import { SettingsDialog } from './components/SettingsDialog';
import { ListingView, VIEW_ICON } from './components/FileViews';
import { DEFAULT_PREFERENCES, normalizePreferences } from './domain/preferences';
import type { Preferences } from './domain/preferences';

const VIEW_BUTTONS = [
  { mode: 'canvas' as const, label: '画布', hint: '自由摆放，保留你拖出来的位置', Icon: Shapes },
  {
    mode: 'tiles' as const,
    label: '平铺',
    hint: '整齐的网格，按名称、类型、大小或时间排序',
    Icon: VIEW_ICON.tiles,
  },
  {
    mode: 'list' as const,
    label: '列表',
    hint: '详细信息表格，可展开文件夹、点表头排序',
    Icon: VIEW_ICON.list,
  },
  {
    mode: 'groups' as const,
    label: '分组',
    hint: '按类型、修改月份或计划状态分栏',
    Icon: VIEW_ICON.groups,
  },
];
function unwrap<T>(response: ApiResult<T>): T {
  if (!response.ok) throw new Error(response.error ?? '操作失败');
  return response.data as T;
}
// What was left out of an import, in the user's words; empty when everything came in.
function importNotice(summary: ImportSummary, overflow = 0): string {
  return [
    overflow
      ? `文件夹超过 ${MAX_NODES} 项，先加入了最近修改的部分，另有 ${overflow} 项未加入。`
      : '',
    summary.limited ? '内容较多的子文件夹没有完整加入，这些文件夹暂时不能整体移动。' : '',
    summary.skipped ? `${summary.skipped} 个无法读取或属于链接的条目已跳过。` : '',
  ].join('');
}
export default function App() {
  const [state, setState] = useState<Workspace | null>(null);
  const current = useRef<Workspace | null>(null);
  const [parentId, setParentId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error'>('saved');
  const saveCounter = useRef(0);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');
  const operationBusy = useRef(false);
  const [starting, setStarting] = useState(true);
  const [dialog, setDialog] = useState<
    | 'create'
    | 'canvas-group'
    | 'collect'
    | 'batch'
    | 'rename'
    | 'projects'
    | 'move'
    | 'preview'
    | 'help'
    | 'draft'
    | 'recovery'
    | 'refresh'
    | 'settings'
    | null
  >(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [renameId, setRenameId] = useState('');
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [records, setRecords] = useState<ProjectRecord[]>([]);
  const [places, setPlaces] = useState<KnownFolder[]>([]);
  const [openMenu, setOpenMenu] = useState<{ x: number; y: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const pageDrag = useRef(false);
  const [externalChanges, setExternalChanges] = useState(0);
  const lastExternalCheck = useRef(0);
  const needsRecovery = useRef(false);
  const [report, setReport] = useState<ApplyReport | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [canvasRevision, setCanvasRevision] = useState(0);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [canUndoDisk, setCanUndoDisk] = useState(false);
  const [operation, setOperation] = useState<OperationStatus | null>(null);
  const [progress, setProgress] = useState<OperationProgress | null>(null);
  const [problem, setProblem] = useState('');
  const [refreshReview, setRefreshReview] = useState<RefreshReview | null>(null);
  const [draftStart, setDraftStart] = useState<DraftMode | undefined>(undefined);
  const [menu, setMenu] = useState<{
    id: string | null;
    x: number;
    y: number;
    extras: MenuItem[];
  } | null>(null);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const [dismissedTips, setDismissedTips] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const prefsNow = useRef(prefs);
  const prefsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tour, setTour] = useState(false);
  const [tourDone, setTourDone] = useState(readTutorialDone);
  async function refreshOperation() {
    const id = current.current?.project.id;
    if (!id) return;
    const result = await window.fileCanvas.operationStatus(id);
    if (current.current?.project.id !== id) return;
    if (result.ok) {
      needsRecovery.current = !!result.data?.needsRecovery;
      setOperation(result.data ?? null);
      setCanUndoDisk(!!result.data?.canUndo);
    } else {
      setProblem(result.error ?? '操作记录读取失败');
    }
  }
  function updateView(view: NonNullable<Project['view']>) {
    if (!current.current) return;
    const existing = current.current.project.view ?? {};
    const merged = { ...existing, ...view };
    if (JSON.stringify(existing) !== JSON.stringify(merged))
      replace({ ...current.current, project: { ...current.current.project, view: merged } });
  }
  // Display preferences apply at once and are saved shortly after the last change.
  function savePrefsNow() {
    if (prefsTimer.current) clearTimeout(prefsTimer.current);
    prefsTimer.current = null;
    return window.fileCanvas
      .savePreferences(prefsNow.current)
      .then((result) => {
        if (!result.ok) notify(`显示设置未能保存：${result.error ?? '未知错误'}`);
      })
      .catch(() => notify('显示设置未能保存。'));
  }
  function updatePrefs(patch: Partial<Preferences>) {
    const next = normalizePreferences({ ...prefsNow.current, ...patch });
    prefsNow.current = next;
    setPrefs(next);
    if (!window.fileCanvas) return;
    if (prefsTimer.current) clearTimeout(prefsTimer.current);
    prefsTimer.current = setTimeout(() => void savePrefsNow(), 300);
  }
  function notify(message: string) {
    setToast(message);
  }
  function replace(next: Workspace) {
    if (current.current?.project.id !== next.project.id) {
      const view = next.project.view;
      setShowBrowser(!!view?.showBrowser);
      setFocused(!!view?.focused);
      setParentId(view?.parentId && next.project.nodes[view.parentId] ? view.parentId : null);
      setOperation(null);
      setCanUndoDisk(false);
      setProblem('');
      setFilter('');
      setExternalChanges(0);
      needsRecovery.current = false;
    }
    current.current = next;
    setState(next);
    if (parentId && !next.project.nodes[parentId]) setParentId(null);
    setSelected((old) => old.filter((id) => next.project.nodes[id]));
  }
  function edit(fn: (state: Workspace) => Workspace) {
    if (!current.current || operationBusy.current) return;
    try {
      replace(fn(current.current));
    } catch (error) {
      notify((error as Error).message);
    }
  }
  async function persist(project = current.current?.project) {
    if (!project) return;
    const version = ++saveCounter.current;
    setSaved('saving');
    try {
      unwrap(await window.fileCanvas.save(project));
      if (version === saveCounter.current) setSaved('saved');
    } catch (error) {
      if (version === saveCounter.current) {
        setSaved('error');
        notify(`保存失败：${(error as Error).message}`);
      }
      throw error;
    }
  }
  useEffect(() => {
    if (!window.fileCanvas) return;
    window.fileCanvas
      .loadPreferences()
      .then((result) => {
        if (!result.ok || !result.data) return;
        // A change made before the file was read wins over what was stored.
        if (prefsTimer.current) return;
        prefsNow.current = result.data.preferences;
        setPrefs(result.data.preferences);
        if (result.data.notice) notify(result.data.notice);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!window.fileCanvas) {
      notify('请通过 Electron 桌面程序启动。普通浏览器不提供本地文件接口。');
      setStarting(false);
      return;
    }
    window.fileCanvas
      .restore()
      .then((result) => {
        const p = unwrap(result);
        if (p) replace(workspace(p));
      })
      .catch((error) => notify(`上次项目未能恢复：${error.message}`))
      .finally(() => setStarting(false));
    refreshPlaces();
  }, []);
  useEffect(() => {
    if (state) void persist(state.project).catch(() => {});
  }, [state?.project]);
  useEffect(() => {
    if (window.fileCanvas) return window.fileCanvas.onOperationProgress(setProgress);
  }, []);
  // Files change outside the program all the time. This only reads and reports; the plan changes
  // when the user adopts the refresh.
  async function lookForExternalChanges() {
    const project = current.current?.project;
    if (!project || operationBusy.current || needsRecovery.current) return;
    lastExternalCheck.current = Date.now();
    const result = await window.fileCanvas.prepareRefresh(project).catch(() => null);
    if (result?.ok && current.current?.project.nodes === project.nodes)
      setExternalChanges(result.data?.changes.length ?? 0);
  }
  useEffect(() => {
    if (state) void refreshOperation().then(lookForExternalChanges);
  }, [state?.project.id]);
  useEffect(() => {
    function returned() {
      if (Date.now() - lastExternalCheck.current > 15000) void lookForExternalChanges();
    }
    window.addEventListener('focus', returned);
    return () => window.removeEventListener('focus', returned);
  }, []);
  useEffect(() => {
    if (state) updateView({ parentId, showBrowser, focused });
  }, [parentId, showBrowser, focused]);
  useEffect(() => {
    if (!window.fileCanvas) return;
    return window.fileCanvas.onCloseRequested(() => {
      if (operationBusy.current) {
        window.fileCanvas.finishClose(false);
        notify('正在处理文件，请完成后再关闭窗口。');
        return;
      }
      void Promise.all([persist(), prefsTimer.current ? savePrefsNow() : null])
        .then(() => window.fileCanvas.finishClose(true))
        .catch(() => window.fileCanvas.finishClose(false, true));
    });
  }, []);
  useEffect(() => {
    const started = () => {
      pageDrag.current = true;
    };
    const ended = () => {
      pageDrag.current = false;
    };
    window.addEventListener('dragstart', started);
    window.addEventListener('dragend', ended);
    return () => {
      window.removeEventListener('dragstart', started);
      window.removeEventListener('dragend', ended);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      // The settings panel is a docked, non-modal panel: the canvas and its shortcuts stay live.
      if (
        (dialog && dialog !== 'settings') ||
        busy ||
        menu ||
        tour ||
        (event.target as HTMLElement).closest('input, textarea, [contenteditable]')
      )
        return;
      if (event.key === 'Escape' && dialog === 'settings') {
        setDialog(null);
        return;
      }
      if (event.key === 'F5' && state && !operation?.needsRecovery) {
        event.preventDefault();
        checkRefresh();
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (event.key.toLowerCase() === 'o') {
          event.preventDefault();
          openFolder();
          return;
        }
        if (event.key === ',') {
          event.preventDefault();
          setDialog('settings');
          return;
        }
        if (event.key.toLowerCase() === 'f' && state) {
          event.preventDefault();
          filterRef.current?.focus();
          filterRef.current?.select();
          return;
        }
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          edit(event.shiftKey ? redo : undo);
        }
        if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          edit(redo);
        }
        if (event.key.toLowerCase() === 's') {
          event.preventDefault();
          void persist().catch(() => {});
        }
        if (event.key.toLowerCase() === 'a' && state) {
          event.preventDefault();
          setSelected(
            Object.values(state.project.nodes)
              .filter((n) => n.parentId === parentId)
              .map((n) => n.id),
          );
        }
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'n' &&
        selected.length
      ) {
        event.preventDefault();
        openCollect();
        return;
      }
      if (event.key === 'F2' && selected.length === 1) {
        event.preventDefault();
        openRename(selected[0]);
      }
      if (event.key === 'F2' && selected.length > 1) {
        event.preventDefault();
        setDialog('batch');
      }
      if (event.key === 'Escape') {
        // Focus mode hides the header, so Esc has to be a way out of it.
        if (!selected.length && focused) setFocused(false);
        setSelected([]);
      }
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [state, dialog, selected, parentId, busy, menu, tour, operation, focused]);
  useEffect(() => {
    function dismiss(event: PointerEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      document.querySelectorAll<HTMLDetailsElement>('.more-tools[open]').forEach((menu) => {
        if (event instanceof KeyboardEvent || !menu.contains(event.target as Node))
          menu.open = false;
      });
    }
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);
  async function run(task: () => Promise<void>, message = '') {
    if (operationBusy.current) return;
    operationBusy.current = true;
    setBusyMessage(message);
    setBusy(true);
    setProblem('');
    try {
      await task();
    } catch (error) {
      setProblem((error as Error).message);
      notify((error as Error).message);
    } finally {
      setBusy(false);
      operationBusy.current = false;
      setProgress(null);
      if (current.current) await refreshOperation();
    }
  }
  // Cards laid out before any canvas has measured itself (nothing open yet) use the window width.
  function canvasColumns() {
    if (!current.current) setGridColumns(columnsForWidth(window.innerWidth));
    return preferredColumns();
  }
  // The dialog, a common place and a dropped folder all open a folder the same way.
  function openFolder(
    choose: () => Promise<ApiResult<Project | null>> = () =>
      window.fileCanvas.openRoot(canvasColumns()),
  ) {
    void run(async () => {
      await persist();
      const project = unwrap(await choose());
      if (!project) return;
      let next = workspace(project);
      let notice = '';
      let browse = false;
      if (Object.keys(project.nodes).length) {
        // The folder already had a project, so that one came back instead of a new one: as it
        // was when its plan is still unapplied, otherwise already updated to the folder's contents.
        notice = hasPendingPlan(project)
          ? '已回到这个文件夹上次没应用的整理计划。外部有新文件时，用“刷新并核对”加入。'
          : '已打开这个文件夹上次的项目，并按文件夹现状更新。';
      } else {
        // The folder is already the open one from here on, so a failure below must still end with
        // this project on screen: otherwise the page and the main process disagree on what is open.
        try {
          const listing = unwrap(await window.fileCanvas.listDirectory(project.rootPath));
          const summary = unwrap(
            await window.fileCanvas.importPaths(
              listing.filter((e) => !e.blocked).map((e) => e.path),
            ),
          );
          canvasColumns();
          next = importEntries(next, summary.entries, null);
          notice = importNotice(summary, listing.find((e) => e.overflow)?.overflow);
        } catch (e) {
          browse = true;
          notice = `文件夹已打开，请从文件栏分批加入：${(e as Error).message}`;
        }
      }
      replace(next);
      if (browse) setShowBrowser(true);
      enter(null);
      setPreview(null);
      setExportPath(null);
      setShowAi(false);
      if (notice) notify(notice);
    });
  }
  function loadProject(id: string) {
    void run(async () => {
      await persist();
      const project = unwrap(await window.fileCanvas.load(id));
      replace(workspace(project));
      enter(null);
      setDialog(null);
      notify('已恢复项目结构与布局。虚拟撤销历史从此次打开开始记录。');
    });
  }
  // Newest project per folder, so opening 下载 several times shows it once.
  const recent = records
    .filter((r, i) => !r.demo && records.findIndex((o) => o.rootPath === r.rootPath) === i)
    .slice(0, 5);
  function refreshPlaces() {
    void window.fileCanvas
      ?.knownFolders()
      .then((result) => result.ok && setPlaces(result.data ?? []))
      .catch(() => {});
    void window.fileCanvas
      ?.projects()
      .then((result) => result.ok && setRecords(result.data ?? []))
      .catch(() => {});
  }
  function openMenuItems(): MenuItem[] {
    return [
      {
        label: '选择文件夹…',
        icon: <FolderOpen size={14} />,
        onClick: () => openFolder(),
      },
      ...places.map((place, index) => ({
        id: `place-${place.id}`,
        label: `整理${place.label}`,
        hint: place.path,
        icon: place.id === 'desktop' ? <Monitor size={14} /> : <Download size={14} />,
        group: index === 0,
        onClick: () => openFolder(() => window.fileCanvas.openKnown(place.id, canvasColumns())),
      })),
      ...recent
        .filter((r) => r.id !== state?.project.id)
        .map((record, index) => ({
          id: `recent-${record.id}`,
          label: record.name,
          hint: record.rootPath,
          icon: <History size={14} />,
          group: index === 0,
          onClick: () => loadProject(record.id),
        })),
    ];
  }
  // Dropping a folder from Explorer anywhere on the welcome page opens it.
  function dropToOpen(event: React.DragEvent) {
    if (!canDropFolder(event)) return;
    event.preventDefault();
    setDropping(false);
    const file = event.dataTransfer.files[0];
    if (!file) return notify('请从资源管理器拖入一个文件夹。');
    openFolder(() => window.fileCanvas.openDropped(file, canvasColumns()));
  }
  // Only a drag from outside the window: dragging something on the page never started here.
  function canDropFolder(event: React.DragEvent) {
    return (
      !pageDrag.current &&
      event.dataTransfer.types.includes('Files') &&
      !busy &&
      !tour &&
      (!dialog || dialog === 'settings')
    );
  }
  async function openDemo(quiet = false) {
    let created = false;
    await run(async () => {
      await persist();
      const project = unwrap(await window.fileCanvas.openDemo(canvasColumns()));
      replace(workspace(project));
      enter(null);
      setPreview(null);
      setExportPath(null);
      created = true;
      if (!quiet) notify('已创建一份新的 20 文件演示副本。你原来的项目已保存，可随时恢复。');
    });
    return created;
  }
  function finishTour() {
    setTour(false);
    writeTutorialDone();
    setTourDone(true);
  }
  // The tour points at real controls, so it needs an open project: with none, it opens the
  // demo copy first (the same one "体验示例" makes), otherwise it runs on the current one.
  async function startTutorial() {
    if (!current.current && !(await openDemo(true))) return;
    setDialog(null);
    setMenu(null);
    setFocused(false);
    setTour(true);
  }
  async function add(paths: string[], destination = parentId, position?: { x: number; y: number }) {
    await run(async () => {
      if (!current.current) return;
      const before = Object.keys(current.current.project.nodes).length;
      const summary = unwrap(await window.fileCanvas.importPaths(paths, MAX_NODES - before));
      const next = importEntries(current.current, summary.entries, destination, position);
      replace(next);
      const count = Object.keys(next.project.nodes).length - before;
      notify(
        (count
          ? `已加入 ${count} 个条目；原始文件保持不变。`
          : '这些文件已经在画布中，无需重复加入。') + importNotice(summary),
      );
    });
  }
  function enter(id: string | null) {
    setFilter('');
    setParentId(id);
    setSelected([]);
    setInspectId(null);
  }
  function openCreateIn(destination: string | null) {
    setCreateParentId(destination);
    setName('新建文件夹');
    setNameError('');
    setDialog('create');
  }
  function openCreate() {
    openCreateIn(parentId);
  }
  function openCanvasGroup() {
    setName('');
    setNameError('');
    setDialog('canvas-group');
  }
  function selectedFiles(nodes: NodeMap, ids: string[]) {
    return ids.flatMap((id) => {
      const node = nodes[id];
      return node?.kind === 'file' && node.source ? [node.source.path] : [];
    });
  }
  function addToCanvasGroup(groupId: string, ids: string[], paths: string[]) {
    const addFiles = (state: Workspace, files: string[]) => {
      if (!files.length) throw new Error('请展开文件夹，把里面的文件拖进分组。');
      return editCanvasGroups(state, '加入画布分组', (groups) =>
        groups.map((group) =>
          group.id === groupId
            ? { ...group, files: uniqueGroupFiles([...group.files, ...files]) }
            : group,
        ),
      );
    };
    if (paths.length) {
      void run(async () => {
        const files = unwrap(await window.fileCanvas.groupFiles(paths));
        replace(addFiles(current.current!, files));
      });
    } else edit((state) => addFiles(state, selectedFiles(state.project.nodes, ids)));
  }
  function removeFromCanvasGroup(groupId: string, file?: string) {
    edit((state) =>
      editCanvasGroups(state, file ? '移出画布分组' : '移除画布分组', (groups) =>
        file
          ? groups.map((group) =>
              group.id === groupId
                ? { ...group, files: group.files.filter((item) => item !== file) }
                : group,
            )
          : groups.filter((group) => group.id !== groupId),
      ),
    );
  }
  function exportCanvasGroup(id: string) {
    void run(async () => {
      const project = current.current!.project;
      await persist(project);
      const result = unwrap(await window.fileCanvas.exportGroup(project, id));
      if (result) notify(`压缩包已保存到 ${result.path}`);
    }, '正在打包分组…');
  }
  function openCollect() {
    const nodes = current.current?.project.nodes;
    if (!nodes || !selected.length) return;
    setName(suggestFolderName(selected.flatMap((id) => (nodes[id] ? [nodes[id]] : []))));
    setNameError('');
    setDialog('collect');
  }
  function openRename(id: string) {
    if (!current.current?.project.nodes[id]) return;
    setRenameId(id);
    setName(current.current.project.nodes[id].name);
    setNameError('');
    setDialog('rename');
  }
  function submitName(event: React.FormEvent) {
    event.preventDefault();
    if (!current.current) return;
    try {
      if (dialog === 'canvas-group') {
        const groupName = name.trim();
        validateName(groupName);
        const files = selectedFiles(current.current.project.nodes, selected);
        const group = { id: crypto.randomUUID(), name: groupName, files };
        replace(editCanvasGroups(current.current, '新建画布分组', (groups) => [...groups, group]));
        if (prefs.viewMode !== 'canvas') updatePrefs({ viewMode: 'canvas' });
        setSelected([]);
        setDialog(null);
        return;
      }
      if (dialog === 'collect') {
        const folderId = crypto.randomUUID();
        const count = selected.length;
        replace(moveToNewFolder(current.current, selected, name, parentId, folderId));
        setSelected([]);
        setDialog(null);
        setHighlighted(folderId);
        setTimeout(() => setHighlighted((old) => (old === folderId ? null : old)), 2600);
        notify(`已把 ${count} 项移入新文件夹“${name}”，Ctrl+Z 可撤销。真实文件尚未移动。`);
        return;
      }
      const next =
        dialog === 'create'
          ? addFolder(current.current, name, createParentId)
          : renameNode(current.current, renameId, name);
      replace(next);
      setDialog(null);
    } catch (error) {
      setNameError((error as Error).message);
    }
  }
  function move(
    ids: string[],
    destination: string | null,
    positions?: Record<string, { x: number; y: number }>,
  ) {
    const before = current.current;
    edit((s) => moveNodes(s, ids, destination, positions));
    if (current.current === before) return;
    // Items put down on the canvas stay selected so the pile can be picked up again.
    if (!positions) setSelected([]);
    const folder = destination ? current.current?.project.nodes[destination] : null;
    if (ids.length > 1 && folder)
      notify(`已把 ${ids.length} 项放入“${folder.name}”，Ctrl+Z 可撤销。`);
  }
  function openFile(id: string) {
    const source = current.current?.project.nodes[id]?.source;
    if (source) openSource(source.path);
  }
  function openSource(file: string) {
    void run(async () => {
      const result = unwrap(await window.fileCanvas.openFile(file));
      if (result.opened)
        notify(
          result.method === 'text-editor'
            ? '已用文本编辑器打开；返回后会刷新预览。'
            : '已用系统默认应用打开；返回后会刷新预览。',
        );
    });
  }
  function revealFile(id: string) {
    const source = current.current?.project.nodes[id]?.source;
    if (source)
      void run(async () => {
        unwrap(await window.fileCanvas.revealFile(source.path));
        notify('已在资源管理器中定位该文件。');
      });
  }
  function openNodeMenu(id: string, x: number, y: number, extras: MenuItem[] = []) {
    if (operationBusy.current || !current.current?.project.nodes[id]) return;
    if (!selected.includes(id)) setSelected([id]);
    setMenu({ id, x, y, extras });
  }
  function openBackgroundMenu(x: number, y: number, extras: MenuItem[]) {
    if (operationBusy.current || !current.current) return;
    setSelected([]);
    setMenu({ id: null, x, y, extras });
  }
  function backgroundItems(extras: MenuItem[]): MenuItem[] {
    return [
      { label: '新建文件夹', icon: <FolderPlus size={14} />, onClick: openCreate },
      { label: '新建分组', icon: <Layers3 size={14} />, onClick: openCanvasGroup },
      ...extras.map((item, index) => ({ ...item, group: index === 0 || item.group })),
      {
        label: '撤销未应用的修改',
        icon: <Undo2 size={14} />,
        shortcut: 'Ctrl+Z',
        disabled: !state?.past.length,
        group: true,
        onClick: () => edit(undo),
      },
      ...(state?.future.length
        ? [
            {
              label: '重做',
              icon: <Redo2 size={14} />,
              shortcut: 'Ctrl+Y',
              onClick: () => edit(redo),
            },
          ]
        : []),
      {
        label: '刷新并核对',
        icon: <RefreshCw size={14} />,
        disabled: !!operation?.needsRecovery,
        group: true,
        onClick: checkRefresh,
      },
    ];
  }
  function menuItems(id: string, extras: MenuItem[]): MenuItem[] {
    const node = current.current?.project.nodes[id];
    if (!node) return [];
    const many = selected.length > 1 && selected.includes(id);
    const items: MenuItem[] = [];
    if (!many)
      items.push({
        label: '预览详情',
        icon: <Eye size={14} />,
        onClick: () => {
          setInspectId(id);
          setShowAi(false);
        },
      });
    if (!many && node.kind === 'folder')
      items.push({
        label: '打开文件夹',
        icon: <Expand size={14} />,
        onClick: () => enter(id),
      });
    if (!many) items.push(...extras);
    if (!many && node.kind === 'file' && node.source)
      items.push({
        label: '用系统应用打开',
        icon: <ExternalLink size={14} />,
        onClick: () => openFile(id),
      });
    if (!many && node.source)
      items.push({
        label: '在资源管理器中显示',
        icon: <FolderOpen size={14} />,
        onClick: () => revealFile(id),
      });
    items.push(
      {
        label: '新建分组',
        icon: <Layers3 size={14} />,
        disabled: !(node.kind === 'file' || (many && selectedFiles(nodes, selected).length)),
        onClick: openCanvasGroup,
      },
      {
        label: '移动到…',
        icon: <MoveRight size={14} />,
        onClick: () => setDialog('move'),
        group: items.length > 0,
      },
      {
        label: '移入新文件夹',
        icon: <FolderPlus size={14} />,
        onClick: openCollect,
        shortcut: 'Ctrl+Shift+N',
      },
      many
        ? {
            label: '批量重命名',
            icon: <Pencil size={14} />,
            onClick: () => setDialog('batch'),
            shortcut: 'F2',
          }
        : {
            label: '重命名',
            icon: <Pencil size={14} />,
            onClick: () => openRename(id),
            shortcut: 'F2',
          },
    );
    if (!many && node.kind === 'folder')
      items.push({
        label: '新建子文件夹',
        icon: <FolderPlus size={14} />,
        onClick: () => openCreateIn(id),
      });
    items.push({
      label: '移出画布',
      hint: '不删除本地文件',
      icon: <X size={14} />,
      onClick: remove,
      danger: true,
      group: true,
    });
    return items;
  }
  function adoptFile(id: string, advice: FileAdvice) {
    edit((s) => applyFileAdvice(s, id, advice));
    const destination = current.current?.project.nodes[id]?.parentId ?? null;
    setHighlighted(destination);
    notify(
      advice.action === 'review-delete'
        ? '已标记待删除候选，原文件仍保留。'
        : advice.action === 'keep'
          ? '已取消待删除标记。'
          : '已采用推荐位置，可撤销；确认整理后才移动真实文件。',
    );
  }
  function revertDisk() {
    void run(async () => {
      const currentProject = current.current!.project;
      const project = unwrap(
        await window.fileCanvas.undoDisk(operation?.projectId ?? currentProject.id, currentProject),
      );
      replace(workspace(project));
      enter(null);
      setCanUndoDisk(false);
      setExternalChanges(0);
      setHighlighted(null);
      setDialog(null);
      notify('已撤销上次磁盘整理，文件恢复到原位置。');
    });
  }
  function checkPlan() {
    void run(async () => {
      setPreview(unwrap(await window.fileCanvas.preview(current.current!.project)));
      setExportPath(null);
      setDialog('preview');
    });
  }
  function checkRefresh() {
    void run(async () => {
      setRefreshReview(unwrap(await window.fileCanvas.prepareRefresh(current.current!.project)));
      setDialog('refresh');
    });
  }
  function remove() {
    edit((s) => {
      const sources: string[] = [];
      const next = commit(s, '移出画布', (nodes) => {
        const removed = Object.keys(nodes).filter((id) =>
          selected.some((parent) => isDescendant(nodes, id, parent)),
        );
        for (const id of removed) {
          if (nodes[id].source) sources.push(id);
          delete nodes[id];
        }
      });
      const removedIds = [...new Set([...(s.project.view?.removedIds ?? []), ...sources])];
      return {
        ...next,
        project: {
          ...next.project,
          view: { ...next.project.view, removedIds: removedIds.slice(-MAX_NODES) },
        },
      };
    });
    setSelected([]);
    notify('已从虚拟画布移出，可撤销。硬盘文件保持不变。');
  }
  const nodes = state?.project.nodes ?? {};
  const imported = new Set(Object.keys(nodes));
  const ancestors: { id: string; name: string }[] = [];
  let nav = parentId;
  while (nav && nodes[nav]) {
    ancestors.unshift({ id: nav, name: nodes[nav].name });
    nav = nodes[nav].parentId;
  }
  const fileCount = Object.values(nodes).filter((n) => n.kind === 'file').length;
  const pendingCount = state ? pendingNodes(state.project).length : 0;
  const filterResult = state ? filterLayer(nodes, parentId, filter) : null;
  const tipKey = `${state?.project.id ?? ''}:${parentId ?? ''}`;
  const tipData = state
    ? suggestRecipes(state, parentId, {
        contentProject: state.project.demo?.scenario === 'content-project',
      })
    : null;
  const tips =
    tipData &&
    prefs.showSuggestions &&
    tipData.loose >= 4 &&
    tipData.items.length &&
    !focused &&
    pendingCount === 0 &&
    !operation?.needsRecovery &&
    !dismissedTips.includes(tipKey)
      ? tipData
      : null;
  return (
    <div
      className={`app-shell canvas-first bg-${prefs.background} ${focused ? 'focus-mode' : ''} ${dialog ? 'has-dialog' : ''} ${prefs.showHints ? '' : 'no-hints'} ${prefs.reduceMotion ? 'reduce-motion' : ''}`}
      onDragOver={(e) => {
        if (!canDropFolder(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={dropToOpen}
    >
      <header className={`main-header ${state ? '' : 'welcome-header'}`}>
        <div className="brand">
          <span className="brand-mark">
            <Files size={20} />
          </span>
          <strong>FileCanvas</strong>
        </div>
        <span className="header-project">{state?.project.name ?? '把文件放到一张画布上'}</span>
        <div className="toolbar-spacer" />
        <button
          className="button subtle"
          aria-haspopup="menu"
          disabled={busy || starting}
          onClick={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            refreshPlaces();
            setOpenMenu({ x: box.left, y: box.bottom + 4 });
          }}
        >
          <FolderOpen size={16} />
          打开文件夹
          <ChevronDown size={13} />
        </button>
        <button
          className="button subtle"
          data-tour="draft"
          disabled={!state || busy}
          onClick={() => {
            setDraftStart('type');
            setDialog('draft');
          }}
        >
          <Layers3 size={16} />
          自动分类
        </button>
        <button
          className="icon-button"
          title={`撤销计划：${state?.past.at(-1)?.label ?? ''} (Ctrl+Z)，不会恢复已经移动的本地文件`}
          aria-label="撤销未应用的修改"
          disabled={!state?.past.length || busy}
          onClick={() => edit(undo)}
        >
          <Undo2 size={18} />
        </button>
        <button
          className="icon-button"
          title="重做 (Ctrl+Y)"
          aria-label="重做"
          disabled={!state?.future.length || busy}
          onClick={() => edit(redo)}
        >
          <Redo2 size={18} />
        </button>
        <button
          className="button primary apply-entry"
          data-tour="apply"
          disabled={!state || busy || !!operation?.needsRecovery}
          onClick={checkPlan}
        >
          <ScanEye size={16} />
          预览并应用{pendingCount > 0 && <span className="count-pill">{pendingCount}</span>}
        </button>
        <details
          className="more-tools"
          data-tour="more"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) e.currentTarget.open = false;
          }}
        >
          <summary aria-label="更多工具" title="更多工具">
            <MoreHorizontal size={20} />
          </summary>
          <div className="more-menu">
            <span className="menu-label">显示与辅助</span>
            <button
              className="button"
              disabled={!state}
              aria-pressed={showBrowser}
              onClick={() => setShowBrowser(!showBrowser)}
            >
              <PanelLeft size={16} />
              原始文件栏
            </button>
            <button
              className="button"
              disabled={!state}
              aria-pressed={showAi}
              onClick={() => {
                setShowAi(!showAi);
                setInspectId(null);
              }}
            >
              <Sparkles size={16} />
              AI 助手
            </button>
            <button
              className="button"
              title="界面设置 (Ctrl+,)"
              onClick={() => setDialog(dialog === 'settings' ? null : 'settings')}
            >
              <SlidersHorizontal size={16} />
              界面设置
            </button>
            <button className="button" disabled={!state} onClick={() => setFocused(!focused)}>
              {focused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              {focused ? '退出专注' : '专注画布'}
            </button>
            <div className="menu-sep" />
            <button
              className="button"
              disabled={!state || busy || !!operation?.needsRecovery}
              onClick={checkRefresh}
            >
              <RefreshCw size={16} />
              刷新并核对
            </button>
            <button
              className="button"
              disabled={!state || busy}
              onClick={() =>
                void persist()
                  .then(() => notify('项目已保存。'))
                  .catch(() => {})
              }
            >
              <Save size={16} />
              保存
            </button>
            <button
              className="button"
              title="打开已保存项目"
              disabled={busy || starting}
              onClick={() =>
                void run(async () => {
                  await persist();
                  setRecords(unwrap(await window.fileCanvas.projects()));
                  setDialog('projects');
                })
              }
            >
              <Files size={16} />
              已保存项目
            </button>
            <button
              className="button demo-entry"
              disabled={busy || starting}
              onClick={() => void openDemo()}
            >
              <Play size={16} />
              体验示例
            </button>
            <button
              className="button"
              disabled={!state}
              onClick={() =>
                void run(async () => {
                  unwrap(await window.fileCanvas.revealRoot());
                })
              }
            >
              <FolderOpen size={16} />
              查看原文件夹
            </button>
            <button
              className="button"
              disabled={!state || busy || !canUndoDisk}
              onClick={() => setDialog('recovery')}
            >
              <ShieldCheck size={16} />
              恢复上次文件移动
            </button>
            <div className="menu-sep" />
            <button
              className="button"
              disabled={busy || starting}
              onClick={() => void startTutorial()}
            >
              <GraduationCap size={16} />
              新手教程
            </button>
            <button className="button" onClick={() => setDialog('help')}>
              <Info size={16} />
              使用说明
            </button>
          </div>
        </details>
      </header>
      {state ? (
        <main className="workspace">
          {showBrowser && !focused && (
            <div className="browser-drawer">
              <div className="drawer-title">
                <span>原始文件</span>
                <button
                  className="icon-button"
                  title="收起文件栏"
                  onClick={() => setShowBrowser(false)}
                >
                  <X size={16} />
                </button>
              </div>
              <Browser
                rootPath={state.project.rootPath}
                projectId={state.project.id}
                imported={imported}
                onImport={(paths) => add(paths)}
                notify={notify}
              />
            </div>
          )}
          <section className="workarea">
            <div className="canvas-navigation">
              <div className="breadcrumb">
                <button
                  className="icon-button"
                  title="返回上一级"
                  disabled={!parentId}
                  onClick={() => enter(nodes[parentId!].parentId)}
                >
                  <ArrowLeft size={16} />
                </button>
                <button className={!parentId ? 'active' : ''} onClick={() => enter(null)}>
                  {state.project.name}
                </button>
                {ancestors.map((a) => (
                  <span key={a.id}>
                    <ChevronRight size={13} />
                    <button
                      className={a.id === parentId ? 'active' : ''}
                      onClick={() => enter(a.id)}
                    >
                      {a.name}
                    </button>
                  </span>
                ))}
              </div>
              {/* The count lives on "预览并应用"; this chip only says the disk is still untouched. */}
              {pendingCount ? (
                <span
                  className="canvas-safe is-pending"
                  data-testid="pending-chip"
                  title={`画布已保存，共 ${pendingCount} 项变化。点“预览并应用”核对后才会改动本地文件。`}
                >
                  <ShieldCheck size={13} />
                  尚未应用 · 本地文件未改动
                </span>
              ) : operation?.status === 'applied' || !externalChanges ? (
                <span className="canvas-safe">
                  <ShieldCheck size={13} />
                  {operation?.status === 'applied' ? '已应用并核验' : '当前路径与本地一致'}
                </span>
              ) : null}
              {focused && (
                <button
                  className="button small"
                  title="退出专注，也可以按 Esc"
                  onClick={() => setFocused(false)}
                >
                  <Minimize2 size={14} />
                  退出专注
                </button>
              )}
              {externalChanges > 0 && !operation?.needsRecovery && (
                <button
                  className="external-changes"
                  data-testid="external-changes"
                  disabled={busy}
                  title="文件夹里的文件在 FileCanvas 之外发生了变化。点这里核对后再决定是否更新。"
                  onClick={checkRefresh}
                >
                  <RefreshCw size={13} />
                  文件夹有 {externalChanges} 处变化
                </button>
              )}
              {canUndoDisk && (
                <button
                  className="button small"
                  disabled={busy}
                  onClick={() => setDialog('recovery')}
                >
                  <Undo2 size={14} />
                  恢复上次文件移动
                </button>
              )}
              <div className="view-switch" role="group" aria-label="展示方式">
                {VIEW_BUTTONS.filter(
                  ({ mode }) => mode === 'canvas' || mode === 'list' || mode === prefs.viewMode,
                ).map(({ mode, label, hint, Icon }) => (
                  <button
                    key={mode}
                    type="button"
                    aria-label={`${label}视图`}
                    title={`${label}：${hint}`}
                    aria-pressed={prefs.viewMode === mode}
                    onClick={() => updatePrefs({ viewMode: mode })}
                  >
                    <Icon size={15} />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div
              className={`operation-notice ${tour ? 'is-tour' : ''} ${operation?.needsRecovery || problem ? 'has-problem' : pendingCount ? 'is-pending' : ''}`}
              data-testid="operation-notice"
              data-tour="notice"
              aria-live="polite"
            >
              {operation?.needsRecovery || problem ? (
                <AlertTriangle size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              <div>
                <strong>
                  {operation?.needsRecovery
                    ? '上次整理需要恢复'
                    : problem
                      ? '上一步没有完成'
                      : pendingCount
                        ? `尚未应用 · ${pendingCount} 项变化`
                        : operation?.status === 'applied'
                          ? '已应用并核验'
                          : '当前路径与本地一致'}
                </strong>
                <span>
                  {problem ||
                    (operation?.needsRecovery
                      ? operation.message
                      : pendingCount
                        ? '画布已保存；本地文件尚未移动。'
                        : '可继续整理，或刷新核对外部变化。')}
                </span>
              </div>
              {operation?.needsRecovery ? (
                <button className="button small" onClick={() => setDialog('recovery')}>
                  处理恢复任务
                </button>
              ) : (
                <button className="button small" disabled={busy} onClick={checkRefresh}>
                  <RefreshCw size={13} />
                  刷新核对
                </button>
              )}
            </div>
            {tips && (
              <SuggestionBar
                loose={tips.loose}
                items={tips.items}
                onPick={(id) => {
                  setDraftStart(id);
                  setDialog('draft');
                }}
                onDismiss={() => setDismissedTips((old) => [...old, tipKey])}
              />
            )}
            {selected.length > 0 && (
              <div className="selection-toolbar">
                <strong>已选择 {selected.length} 项</strong>
                <button
                  className="text-button"
                  aria-haspopup="menu"
                  aria-label="所选文件操作"
                  disabled={busy}
                  onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    openNodeMenu(selected[0], box.left, box.bottom + 4);
                  }}
                >
                  操作 <ChevronDown size={14} />
                </button>
                <button className="icon-button" title="取消选择" onClick={() => setSelected([])}>
                  <X size={14} />
                </button>
              </div>
            )}
            {prefs.viewMode === 'canvas' || tour ? (
              <Canvas
                key={`${state.project.id}-${parentId ?? 'root'}-${canvasRevision}`}
                nodes={nodes}
                groups={state.project.canvasGroups ?? []}
                onGroupDrop={addToCanvasGroup}
                onGroupOpen={openSource}
                onGroupExport={exportCanvasGroup}
                onGroupRemove={removeFromCanvasGroup}
                rootPath={state.project.rootPath}
                initialExpanded={state.project.view?.expandedIds}
                onExpandedChange={(expandedIds) => updateView({ expandedIds })}
                autoExpand={state.project.demo?.scenario === 'expanded-flow'}
                zoom={prefs.iconScale}
                previews={prefs.showPreviews}
                onZoom={(iconScale) => updatePrefs({ iconScale })}
                parentId={parentId}
                selected={selected}
                onSelect={setSelected}
                onEnter={enter}
                onCreate={openCreate}
                onRename={openRename}
                onInspect={(id) => {
                  setInspectId(id);
                  setShowAi(false);
                }}
                onBrowse={() => setShowBrowser(true)}
                onOpen={openFile}
                onContextMenu={openNodeMenu}
                onBackgroundMenu={openBackgroundMenu}
                filter={filter}
                filterResult={filterResult}
                filterRef={filterRef}
                onFilterChange={setFilter}
                onSelectMatches={() => {
                  if (!filterResult?.matches.size) return;
                  const ids = selectableMatches(nodes, filterResult);
                  setSelected(ids);
                  notify(`已选中 ${ids.length} 项匹配的条目，可移入新文件夹或批量处理。`);
                }}
                highlighted={highlighted}
                onMove={move}
                onImport={add}
                snapToGrid={prefs.snapToGrid}
                onNotice={notify}
                onLayout={(positions, label = '调整画布布局') =>
                  edit((s) =>
                    commit(s, label, (next: NodeMap) => {
                      for (const [id, pos] of Object.entries(positions))
                        if (next[id]) Object.assign(next[id], pos);
                    }),
                  )
                }
              />
            ) : (
              <ListingView
                key={`${state.project.id}-${parentId ?? 'root'}-${canvasRevision}`}
                mode={prefs.viewMode}
                nodes={nodes}
                rootPath={state.project.rootPath}
                parentId={parentId}
                selected={selected}
                highlighted={highlighted}
                sortKey={prefs.sortKey}
                sortDir={prefs.sortDir}
                groupBy={prefs.groupBy}
                onSort={(sortKey, sortDir) => updatePrefs({ sortKey, sortDir })}
                onGroupBy={(groupBy) => updatePrefs({ groupBy })}
                zoom={prefs.iconScale}
                previews={prefs.showPreviews}
                onZoom={(iconScale) => updatePrefs({ iconScale })}
                filter={filter}
                filterResult={filterResult}
                filterRef={filterRef}
                onFilterChange={setFilter}
                onSelectMatches={() => {
                  if (!filterResult?.matches.size) return;
                  const ids = selectableMatches(nodes, filterResult);
                  setSelected(ids);
                  notify(`已选中 ${ids.length} 项匹配的条目，可移入新文件夹或批量处理。`);
                }}
                onSelect={setSelected}
                onEnter={enter}
                onInspect={(id) => {
                  setInspectId(id);
                  setShowAi(false);
                }}
                onOpen={openFile}
                onContextMenu={openNodeMenu}
                onBackgroundMenu={openBackgroundMenu}
                onMove={move}
                onImport={add}
                onBrowse={() => setShowBrowser(true)}
                onCreate={openCreate}
              />
            )}
          </section>
          {!focused && inspectId && nodes[inspectId] && (
            <FileInspector
              key={`${state.project.id}-${inspectId}`}
              node={nodes[inspectId]}
              project={state.project}
              onClose={() => {
                setInspectId(null);
                setHighlighted(null);
              }}
              onEnter={enter}
              onSelect={(id) => {
                setInspectId(id);
                setSelected([id]);
              }}
              onSettings={() => {
                setInspectId(null);
                setShowAi(true);
              }}
              onOpen={openFile}
              onAdopt={adoptFile}
              onHighlight={setHighlighted}
              onLocate={(id) => {
                setParentId(null);
                setHighlighted(id);
              }}
            />
          )}
          {
            <AiPanel
              visible={!focused && showAi}
              key={`${state.project.id}-${parentId ?? 'root'}`}
              project={state.project}
              parentId={parentId}
              ids={
                selected.length
                  ? Object.values(nodes)
                      .filter(
                        (n) =>
                          selected.includes(n.id) ||
                          selected.some((id) => isDescendant(nodes, n.parentId, id)),
                      )
                      .map((n) => n.id)
                  : Object.values(nodes)
                      .filter((n) => parentId === null || isDescendant(nodes, n.parentId, parentId))
                      .map((n) => n.id)
              }
              onClose={() => setShowAi(false)}
              onAdopt={(groups, ids) => {
                try {
                  if (current.current) {
                    replace(adoptAiPlan(current.current, parentId, groups, ids));
                    setSelected([]);
                    setCanvasRevision((v) => v + 1);
                    notify('已采用 AI 草案到画布，Ctrl+Z 可一次撤销。');
                  }
                } catch (e) {
                  notify((e as Error).message);
                }
              }}
            />
          }
        </main>
      ) : (
        <main className={`welcome ${dropping ? 'is-dropping' : ''}`}>
          <div className="welcome-hero">
            <div className="welcome-copy">
              <span className="welcome-eyebrow">
                <Sparkles size={13} />
                先想清楚，再动文件
              </span>
              <h1>
                把文件，<em>整理清楚。</em>
              </h1>
              <p>
                看清类型和大小，拖进文件夹就能归类。
                <br />
                核对路径后应用，完成后可恢复上次文件移动。
              </p>
              <div className="welcome-actions">
                <button
                  className="button primary large"
                  disabled={starting || busy}
                  onClick={() => openFolder()}
                >
                  <FolderOpen size={18} />
                  选择文件夹，开始整理
                </button>
                <button
                  className="button large welcome-demo"
                  disabled={starting || busy}
                  onClick={() => void openDemo()}
                >
                  <Play size={16} />
                  试用示例文件
                </button>
              </div>
              {tourDone ? (
                <button
                  className="text-button welcome-replay"
                  disabled={starting || busy}
                  onClick={() => void startTutorial()}
                >
                  <GraduationCap size={14} />
                  重新看新手教程
                </button>
              ) : (
                <button
                  className="text-button welcome-replay"
                  disabled={starting || busy}
                  onClick={() => void startTutorial()}
                >
                  <GraduationCap size={14} />
                  开始新手教程
                </button>
              )}
              {!!places.length && (
                <div className="welcome-places" aria-label="常用位置">
                  <span>常用位置</span>
                  {places.map((place) => (
                    <button
                      key={place.id}
                      className="button welcome-place"
                      title={place.path}
                      disabled={starting || busy}
                      onClick={() =>
                        openFolder(() => window.fileCanvas.openKnown(place.id, canvasColumns()))
                      }
                    >
                      {place.id === 'desktop' ? <Monitor size={15} /> : <Download size={15} />}
                      整理{place.label}
                    </button>
                  ))}
                  <small>或把文件夹拖进窗口</small>
                </div>
              )}
              {!!recent.length && (
                <div className="welcome-recent" aria-label="最近整理">
                  <span>最近整理</span>
                  {recent.slice(0, 3).map((record) => (
                    <button
                      key={record.id}
                      className="welcome-recent-item"
                      title={record.rootPath}
                      disabled={starting || busy}
                      onClick={() => loadProject(record.id)}
                    >
                      <History size={14} />
                      <strong>{record.name}</strong>
                      <small>{record.rootPath}</small>
                      <time>{new Date(record.updatedAt).toLocaleDateString('zh-CN')}</time>
                    </button>
                  ))}
                </div>
              )}
              <div className="welcome-note">
                <ShieldCheck size={15} />
                拖动先预演，确认整理后才实际移动文件。
              </div>
            </div>
            <WelcomeArt />
          </div>
        </main>
      )}
      {dropping && (
        <div className="welcome-drop" data-testid="welcome-drop">
          <FolderOpen size={34} />
          <strong>松手，打开这个文件夹</strong>
          <span>
            只会读取文件信息，确认应用前不会移动任何文件
            {state ? '；当前项目已自动保存' : ''}
          </span>
        </div>
      )}
      <footer className="statusbar">
        <span className="status-path" title={state?.project.rootPath}>
          {state?.project.demo
            ? `演示副本 · ${state.project.name}`
            : (state?.project.rootPath ?? '尚未打开文件夹')}
        </span>
        <span title="项目内全部内容，包括文件夹里的">
          共 {fileCount} 个文件 · {Object.keys(nodes).length - fileCount} 个文件夹
        </span>
        <span>{pendingCount} 项待变更</span>
        <span
          className={`save-state ${saved === 'error' ? 'warning-text' : ''}`}
          data-testid="save-state"
        >
          {saved === 'saving' ? <LoaderCircle size={12} className="spin" /> : <Check size={12} />}
          {saved === 'saved'
            ? state
              ? '项目已保存'
              : '准备就绪'
            : saved === 'saving'
              ? '正在保存…'
              : '保存失败，请重试'}
        </span>
      </footer>
      {toast && (
        <div role="status" className="toast">
          <Info size={17} />
          <span>{toast}</span>
          <button className="icon-button" title="关闭提示" onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
      {tour && <Tutorial onClose={finishTour} />}
      {openMenu && (
        <ContextMenu
          x={openMenu.x}
          y={openMenu.y}
          label="打开"
          items={openMenuItems()}
          onClose={() => setOpenMenu(null)}
        />
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={menu.id ? '文件操作' : '画布操作'}
          title={
            menu.id
              ? selected.length > 1 && selected.includes(menu.id)
                ? `已选择 ${selected.length} 项`
                : nodes[menu.id]?.name
              : '当前文件夹'
          }
          items={menu.id ? menuItems(menu.id, menu.extras) : backgroundItems(menu.extras)}
          onClose={() => setMenu(null)}
        />
      )}
      {(busy || starting) && (
        <div className="busy-overlay">
          <div>
            <LoaderCircle size={22} className="spin" />
            {starting
              ? '正在恢复项目…'
              : progress
                ? `${progress.phase} · ${progress.completed}/${progress.total}`
                : busyMessage || '正在读取与检查…'}
          </div>
        </div>
      )}
      {(dialog === 'create' ||
        dialog === 'collect' ||
        dialog === 'canvas-group' ||
        dialog === 'rename') && (
        <Modal
          title={
            dialog === 'canvas-group'
              ? '新建分组'
              : dialog === 'create'
                ? '新建虚拟文件夹'
                : dialog === 'collect'
                  ? `把 ${selected.length} 项移入新文件夹`
                  : '重命名虚拟条目'
          }
          subtitle={
            dialog === 'canvas-group'
              ? '分组保存在画布里，原文件留在原处。'
              : dialog === 'create'
                ? `将在“${createParentId ? nodes[createParentId]?.name : state?.project.name}”中新建，仅修改整理计划。`
                : dialog === 'collect'
                  ? '新文件夹建在选中项所在的位置；仅修改虚拟整理项目，原始文件不会改变。'
                  : '仅修改虚拟整理项目，原始文件不会改变。'
          }
          onClose={() => setDialog(null)}
        >
          <form onSubmit={submitName} className="name-form">
            <label>
              名称
              <input
                autoFocus
                aria-label="名称"
                maxLength={200}
                placeholder={dialog === 'canvas-group' ? '例如 发给老师' : undefined}
                value={name}
                onFocus={(event) => event.target.select()}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError('');
                }}
              />
            </label>
            {nameError && (
              <p className="inline-error" role="alert">
                {nameError}
              </p>
            )}
            <div className="form-footer">
              <button type="button" className="button" onClick={() => setDialog(null)}>
                取消
              </button>
              <button className="button primary" type="submit">
                {dialog === 'create' ? '创建' : dialog === 'collect' ? '创建并移入' : '确认重命名'}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {dialog === 'projects' && (
        <ProjectsDialog
          records={records}
          activeId={state?.project.id ?? null}
          onClose={() => setDialog(null)}
          onLoad={loadProject}
          onDelete={(id) =>
            void run(async () => {
              unwrap(await window.fileCanvas.deleteProject(id));
              setRecords(unwrap(await window.fileCanvas.projects()));
              notify('已删除这条项目记录，文件夹和文件没有改动。');
            })
          }
        />
      )}
      {dialog === 'batch' && (
        <BatchRenameDialog
          nodes={nodes}
          ids={selected}
          rootName={state?.project.name ?? ''}
          onClose={() => setDialog(null)}
          onApply={(rows) => {
            try {
              if (!current.current) return;
              replace(applyBatchRename(current.current, rows));
              setDialog(null);
              notify(
                `已在计划中批量重命名 ${rows.filter((r) => r.changed).length} 项，Ctrl+Z 可撤销。真实文件尚未改名。`,
              );
            } catch (error) {
              notify((error as Error).message);
            }
          }}
        />
      )}
      {dialog === 'move' && (
        <MoveDialog
          nodes={nodes}
          onClose={() => setDialog(null)}
          onMove={(id) => {
            try {
              if (current.current) {
                replace(moveNodes(current.current, selected, id));
                setSelected([]);
                setDialog(null);
              }
            } catch (error) {
              notify((error as Error).message);
            }
          }}
        />
      )}
      {dialog === 'preview' && preview && (
        <PreviewDialog
          preview={preview}
          errorMessage={problem}
          showUnchanged={showUnchanged}
          setShowUnchanged={setShowUnchanged}
          onClose={() => setDialog(null)}
          rootPath={state!.project.rootPath}
          exportPath={exportPath}
          onExport={() =>
            void run(async () => {
              const result = unwrap(await window.fileCanvas.exportPlan(current.current!.project));
              setExportPath(result.path);
              setPreview(result.preview);
              notify('已导出包含结构对照和检查结果的方案。所有真实文件保持原位。');
            })
          }
          onReveal={() =>
            void run(async () => {
              unwrap(await window.fileCanvas.revealExport());
            })
          }
          onApply={() =>
            void run(async () => {
              const planned = current.current!.project;
              // Taken before applying: afterwards the sources already point at the new places.
              const comparison = comparePlan(planned.nodes, planned.rootPath);
              const count = (...kinds: string[]) =>
                preview.changes.filter((c) => kinds.includes(c.kind)).length;
              const result = unwrap(await window.fileCanvas.applyChanges(planned, preview.planId!));
              replace(workspace(result.project));
              enter(null);
              setDialog(null);
              setCanUndoDisk(true);
              setExternalChanges(0);
              setHighlighted(null);
              setReport({
                comparison,
                moved: count('move', 'move-rename'),
                renamed: count('rename'),
                created: count('create'),
                projectName: planned.name,
                finishedAt: new Date().toISOString(),
              });
            })
          }
        />
      )}
      {report && (
        <ReportDialog
          report={report}
          onRecover={() => {
            setReport(null);
            setDialog('recovery');
          }}
          onClose={() => setReport(null)}
        />
      )}
      {dialog === 'recovery' && state && (
        <RecoveryDialog
          task={operation}
          error={problem}
          rootPath={state.project.rootPath}
          onClose={() => setDialog(null)}
          onRecover={revertDisk}
        />
      )}
      {dialog === 'refresh' && refreshReview && (
        <RefreshDialog
          review={refreshReview}
          onClose={() => setDialog(null)}
          onAdopt={() => {
            replace(workspace(refreshReview.project));
            setExternalChanges(0);
            setDialog(null);
            setCanvasRevision((v) => v + 1);
            setInspectId(null);
            notify('已更新文件基准并保留可用的整理计划。本地文件未移动。');
          }}
        />
      )}
      {dialog === 'draft' && state && (
        <DraftDialog
          state={state}
          parentId={parentId}
          initialMode={draftStart}
          columns={preferredColumns()}
          onClose={() => setDialog(null)}
          onAdopt={(mode, options) => {
            if (!current.current) return;
            const draft = buildClassificationDraft(current.current, parentId, mode, options);
            if (!draft.next) {
              notify(draft.issues.join('；'));
              return;
            }
            replace(draft.next);
            setCanvasRevision((value) => value + 1);
            setSelected([]);
            setDialog(null);
            notify(
              `已把 ${draft.rows.length} 个文件的草案放到画布，可一次撤销。真实文件尚未移动。`,
            );
          }}
        />
      )}
      {dialog === 'settings' && (
        <SettingsDialog
          prefs={prefs}
          onChange={updatePrefs}
          onReset={() => updatePrefs(DEFAULT_PREFERENCES)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'help' && (
        <HelpDialog
          onTutorial={() => void startTutorial()}
          onClose={() => setDialog(null)}
          notify={notify}
        />
      )}
    </div>
  );
}
