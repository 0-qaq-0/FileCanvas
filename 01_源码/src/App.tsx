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
} from 'lucide-react';
import type {
  ApiResult,
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
  importEntries,
  moveNodes,
  redo,
  renameNode,
  undo,
  workspace,
  isDescendant,
  moveToNewFolder,
} from './domain/workspace';
import { Browser } from './components/Browser';
import { Canvas } from './components/ExpandedCanvas';
import { Modal, MoveDialog, PreviewDialog, ProjectsDialog } from './components/Dialogs';
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

function unwrap<T>(response: ApiResult<T>): T {
  if (!response.ok) throw new Error(response.error ?? '操作失败');
  return response.data as T;
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
  const operationBusy = useRef(false);
  const [starting, setStarting] = useState(true);
  const [dialog, setDialog] = useState<
    | 'create'
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
    | null
  >(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [renameId, setRenameId] = useState('');
  const [records, setRecords] = useState<ProjectRecord[]>([]);
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
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [filter, setFilter] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const [dismissedTips, setDismissedTips] = useState<string[]>([]);
  async function refreshOperation() {
    const id = current.current?.project.id;
    if (!id) return;
    const result = await window.fileCanvas.operationStatus(id);
    if (current.current?.project.id !== id) return;
    if (result.ok) {
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
  }, []);
  useEffect(() => {
    if (state) void persist(state.project).catch(() => {});
  }, [state?.project]);
  useEffect(() => {
    if (state) void refreshOperation();
  }, [state?.project.id]);
  useEffect(() => {
    if (window.fileCanvas) return window.fileCanvas.onOperationProgress(setProgress);
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
      void persist()
        .then(() => window.fileCanvas.finishClose(true))
        .catch(() => {
          window.fileCanvas.finishClose(false);
          notify('最后一次保存失败，窗口保持打开。请保存成功后再关闭。');
        });
    });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 6500);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        dialog ||
        busy ||
        menu ||
        (event.target as HTMLElement).closest('input, textarea, [contenteditable]')
      )
        return;
      if (event.ctrlKey || event.metaKey) {
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
      if (event.key === 'Escape') setSelected([]);
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [state, dialog, selected, parentId, busy, menu]);
  async function run(task: () => Promise<void>) {
    if (operationBusy.current) return;
    operationBusy.current = true;
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
  function openFolder() {
    void run(async () => {
      await persist();
      const project = unwrap(await window.fileCanvas.openRoot());
      if (project) {
        const entries = unwrap(await window.fileCanvas.listDirectory(project.rootPath));
        try {
          const imported = unwrap(
            await window.fileCanvas.importPaths(
              entries.filter((e) => !e.blocked).map((e) => e.path),
            ),
          );
          replace(importEntries(workspace(project), imported, null));
        } catch (e) {
          replace(workspace(project));
          setShowBrowser(true);
          notify(`文件夹已打开，请从文件栏分批加入：${(e as Error).message}`);
        }
        setParentId(null);
        setSelected([]);
        setPreview(null);
        setExportPath(null);
        setInspectId(null);
        setShowAi(false);
      }
    });
  }
  function openDemo() {
    void run(async () => {
      await persist();
      const project = unwrap(await window.fileCanvas.openDemo());
      replace(workspace(project));
      enter(null);
      setPreview(null);
      setExportPath(null);
      notify('已创建一份新的 20 文件演示副本。你原来的项目已保存，可随时恢复。');
    });
  }
  async function add(paths: string[], destination = parentId, position?: { x: number; y: number }) {
    await run(async () => {
      if (!current.current) return;
      const entries = unwrap(await window.fileCanvas.importPaths(paths));
      const before = Object.keys(current.current.project.nodes).length;
      const next = importEntries(current.current, entries, destination, position);
      replace(next);
      const count = Object.keys(next.project.nodes).length - before;
      notify(
        count
          ? `已加入 ${count} 个条目；原始文件保持不变。`
          : '这些文件已经在画布中，无需重复加入。',
      );
    });
  }
  function enter(id: string | null) {
    setFilter('');
    setParentId(id);
    setSelected([]);
    setInspectId(null);
  }
  function openCreate() {
    setName('新建文件夹');
    setNameError('');
    setDialog('create');
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
          ? addFolder(current.current, name, parentId)
          : renameNode(current.current, renameId, name);
      replace(next);
      setDialog(null);
    } catch (error) {
      setNameError((error as Error).message);
    }
  }
  function move(ids: string[], destination: string | null) {
    edit((s) => moveNodes(s, ids, destination));
    setSelected([]);
  }
  function openFile(id: string) {
    const source = current.current?.project.nodes[id]?.source;
    if (source)
      void run(async () => {
        const result = unwrap(await window.fileCanvas.openFile(source.path));
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
  function menuItems(id: string): MenuItem[] {
    const node = current.current?.project.nodes[id];
    if (!node) return [];
    const many = selected.length > 1 && selected.includes(id);
    const items: MenuItem[] = [];
    if (!many && node.kind === 'file')
      items.push({
        label: '查看内容和解释',
        icon: <Eye size={14} />,
        onClick: () => {
          setInspectId(id);
          setShowAi(false);
        },
      });
    if (!many && node.kind === 'folder')
      items.push({
        label: '单独查看此文件夹',
        icon: <Expand size={14} />,
        onClick: () => enter(id),
      });
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
        label: '移动到…',
        icon: <MoveRight size={14} />,
        onClick: () => setDialog('move'),
        group: items.length > 0,
      },
      { label: '移入新文件夹', icon: <FolderPlus size={14} />, onClick: openCollect },
      many
        ? { label: '批量重命名', icon: <Pencil size={14} />, onClick: () => setDialog('batch') }
        : { label: '重命名', icon: <Pencil size={14} />, onClick: () => openRename(id) },
      { label: '移出画布', icon: <X size={14} />, onClick: remove, danger: true, group: true },
    );
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
      const project = unwrap(
        await window.fileCanvas.undoDisk(operation?.projectId ?? current.current!.project.id),
      );
      replace(workspace(project));
      enter(null);
      setCanUndoDisk(false);
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
    edit((s) =>
      commit(s, '移出画布', (nodes) => {
        const removed = Object.keys(nodes).filter((id) =>
          selected.some((parent) => isDescendant(nodes, id, parent)),
        );
        removed.forEach((id) => delete nodes[id]);
      }),
    );
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
  const pendingCount = Object.values(nodes).filter((n) => {
    if (!n.source) return true;
    const parts = [n.name];
    let parent = n.parentId;
    while (parent && nodes[parent]) {
      parts.unshift(nodes[parent].name);
      parent = nodes[parent].parentId;
    }
    return (
      `${state!.project.rootPath.replace(/[\\/]$/, '')}\\${parts.join('\\')}` !== n.source.path
    );
  }).length;
  const filterResult = state ? filterLayer(nodes, parentId, filter) : null;
  const tipKey = `${state?.project.id ?? ''}:${parentId ?? ''}`;
  const tipData = state
    ? suggestRecipes(state, parentId, {
        contentProject: state.project.demo?.scenario === 'content-project',
      })
    : null;
  const tips =
    tipData &&
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
      className={`app-shell canvas-first ${focused ? 'focus-mode' : ''} ${dialog ? 'has-dialog' : ''}`}
    >
      <header className="main-header">
        <div className="brand">
          <span className="brand-mark">
            <Files size={20} />
          </span>
          <strong>FileCanvas</strong>
        </div>
        <span className="header-project">{state?.project.name ?? '把文件放到一张画布上'}</span>
        <div className="toolbar-spacer" />
        <button className="button subtle" disabled={busy || starting} onClick={openFolder}>
          <FolderOpen size={16} />
          打开文件夹
        </button>
        <button
          className={`button ${showBrowser ? 'active-tool' : 'subtle'}`}
          disabled={!state}
          aria-pressed={showBrowser}
          onClick={() => setShowBrowser(!showBrowser)}
        >
          <PanelLeft size={16} />
          文件栏
        </button>
        <button
          className="icon-button"
          title={`撤销计划：${state?.past.at(-1)?.label ?? ''} (Ctrl+Z)，不会恢复已经移动的本地文件`}
          aria-label="撤销"
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
          disabled={!state || busy || !!operation?.needsRecovery}
          onClick={checkPlan}
        >
          <ScanEye size={16} />
          检查并应用{pendingCount > 0 && <span className="count-pill">{pendingCount}</span>}
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
        <details
          className="more-tools"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('button')) e.currentTarget.open = false;
          }}
        >
          <summary aria-label="更多工具" title="更多工具">
            <MoreHorizontal size={20} />
          </summary>
          <div className="more-menu">
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
            <button className="button demo-entry" disabled={busy || starting} onClick={openDemo}>
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
              <span className="canvas-safe">
                <ShieldCheck size={13} />
                整理计划 · 确认后应用
              </span>
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
              <button
                className="button small"
                onClick={() => {
                  setDraftStart(undefined);
                  setDialog('draft');
                }}
                disabled={busy}
              >
                <Layers3 size={14} />
                分类草案
              </button>
              <button className="button small" onClick={openCreate} disabled={busy}>
                <FolderPlus size={14} />
                新建文件夹
              </button>
              <button className="button small focus-button" onClick={() => setFocused(!focused)}>
                {focused ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {focused ? '退出专注' : '专注画布'}
              </button>
            </div>
            <div
              className={`operation-notice ${operation?.needsRecovery || problem ? 'has-problem' : ''}`}
              data-testid="operation-notice"
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
                <button className="text-button" onClick={() => setDialog('move')}>
                  <MoveRight size={14} />
                  移动到…
                </button>
                <button className="text-button" onClick={openCollect}>
                  <FolderPlus size={14} />
                  移入新文件夹
                </button>
                {selected.length > 1 ? (
                  <button className="text-button" onClick={() => setDialog('batch')}>
                    <Pencil size={14} />
                    批量重命名
                  </button>
                ) : (
                  <button className="text-button" onClick={() => openRename(selected[0])}>
                    <Pencil size={14} />
                    重命名
                  </button>
                )}
                <button className="text-button" onClick={remove}>
                  <X size={14} />
                  移出画布
                </button>
                <button className="icon-button" title="取消选择" onClick={() => setSelected([])}>
                  <X size={14} />
                </button>
              </div>
            )}
            <Canvas
              key={`${state.project.id}-${parentId ?? 'root'}-${canvasRevision}`}
              nodes={nodes}
              rootPath={state.project.rootPath}
              initialExpanded={state.project.view?.expandedIds}
              onExpandedChange={(expandedIds) => updateView({ expandedIds })}
              autoExpand={state.project.demo?.scenario === 'expanded-flow'}
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
              onContextMenu={(id, x, y) => setMenu({ id, x, y })}
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
              onLayout={(positions) =>
                edit((s) =>
                  commit(s, '调整画布布局', (next: NodeMap) => {
                    for (const [id, pos] of Object.entries(positions))
                      if (next[id]) Object.assign(next[id], pos);
                  }),
                )
              }
            />
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
        <main className="welcome">
          <div className="welcome-art">
            <span className="brand-mark">
              <Files size={36} />
            </span>
            <Sparkles size={20} />
          </div>
          <span className="eyebrow">先想清楚，再动文件</span>
          <h1>看清文件，整理后应用到本地。</h1>
          <p>
            在自由画布中排列、归类和调整文件。
            <br />
            核对路径后应用，完成后可恢复上次文件移动。
          </p>
          <button className="button primary large" disabled={starting || busy} onClick={openFolder}>
            <FolderOpen size={18} />
            选择文件夹，开始整理
          </button>
          <button className="button welcome-demo" disabled={starting || busy} onClick={openDemo}>
            <Play size={16} />
            先用 20 个示例文件试一遍
          </button>
          <div className="welcome-steps">
            <span>
              <PanelLeft size={19} />
              浏览原始文件
            </span>
            <ChevronRight size={15} />
            <span>
              <FolderPlus size={19} />
              在画布中分类
            </span>
            <ChevronRight size={15} />
            <span>
              <ScanEye size={19} />
              核对并应用到本地
            </span>
          </div>
          <div className="welcome-note">
            <ShieldCheck size={15} />
            拖动先预演，确认整理后才实际移动文件。
          </div>
        </main>
      )}
      <footer className="statusbar">
        <span className="status-path" title={state?.project.rootPath}>
          {state?.project.demo
            ? `演示副本 · ${state.project.name}`
            : (state?.project.rootPath ?? '尚未打开文件夹')}
        </span>
        <span>
          {fileCount} 个文件 · {Object.keys(nodes).length - fileCount} 个文件夹
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
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.id)}
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
                : '正在读取与检查…'}
          </div>
        </div>
      )}
      {(dialog === 'create' || dialog === 'collect' || dialog === 'rename') && (
        <Modal
          title={
            dialog === 'create'
              ? '新建虚拟文件夹'
              : dialog === 'collect'
                ? `把 ${selected.length} 项移入新文件夹`
                : '重命名虚拟条目'
          }
          subtitle={
            dialog === 'collect'
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
          onClose={() => setDialog(null)}
          onLoad={(id) =>
            void run(async () => {
              await persist();
              const project = unwrap(await window.fileCanvas.load(id));
              replace(workspace(project));
              enter(null);
              setDialog(null);
              notify('已恢复项目结构与布局。虚拟撤销历史从此次打开开始记录。');
            })
          }
        />
      )}
      {dialog === 'batch' && (
        <BatchRenameDialog
          nodes={nodes}
          ids={selected}
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
              const result = unwrap(
                await window.fileCanvas.applyChanges(current.current!.project, preview.planId!),
              );
              replace(workspace(result.project));
              enter(null);
              setDialog(null);
              setCanUndoDisk(true);
              setHighlighted(null);
              notify(result.message);
            })
          }
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
      {dialog === 'help' && (
        <Modal title="先虚拟整理，再核对结果" onClose={() => setDialog(null)}>
          <div className="help-content">
            <p>
              1. 选择本地文件夹，自动将文件加入画布。文件栏、内容预览与 AI
              助手均可收起；“专注画布”可铺满窗口。
            </p>
            <p>
              2. 勾选文件后加入画布，或直接拖到右侧。导入文件夹会读取整个子树，最多 5000
              项；遇到不安全条目时整批拒绝。
            </p>
            <p>
              3.
              点击文件夹同屏展开，直接拖入或拖出容器；单击文件看内容和解释，双击用系统应用打开。多选可批量移动。右键卡片有常用操作；Ctrl+F
              筛选当前层，“选中匹配项”后可“移入新文件夹”（Ctrl+Shift+N）；选中多项按 F2
              批量重命名。Ctrl+Z / Ctrl+Y 撤销和重做。
            </p>
            <p>
              4. 自动保存包含虚拟结构与各层坐标，Ctrl+S
              手动保存。打开已保存项目可恢复进度；重启后撤销历史会重新开始。
            </p>
            <p>
              5.
              “检查并应用”会核对真实路径、同名冲突和文件夹完整性。点“应用到本地文件”执行并核验结果，支持本地同卷文件和文件夹的移动、重命名和新建分类目录，每次最多
              100 个文件。
            </p>
            <p>
              6.
              “分类草案”提供四种整理方式（内容项目、按文件类型、按修改月份、久未修改归档），按目标文件夹分组预览，可关闭不想整理的组；采用后仍是虚拟结构，不确定的由你调整。预览中的“结构对照”可比较两棵树，并导出
              Markdown 方案到软件自己的 exports 目录。
            </p>
            <p>7. “体验示例”每次创建新的真实样例副本并自动加入画布，不会覆盖你已经保存的项目。</p>
            <p>
              8. “更多工具 →
              恢复上次文件移动”恢复最近一次实际整理；中断任务持续显示在画布顶部。如果涉及文件被外部修改或原位置出现新文件，会停止并提示。使用“刷新核对”查看外部变化并更新草案。“待删除”仅是标记，不会删除文件。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
