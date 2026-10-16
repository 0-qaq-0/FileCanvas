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
} from 'lucide-react';
import type {
  ApiResult,
  NodeMap,
  Preview,
  Project,
  ProjectRecord,
  Workspace,
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
} from './domain/workspace';
import { Browser } from './components/Browser';
import { Canvas } from './components/Canvas';
import { Modal, MoveDialog, PreviewDialog, ProjectsDialog } from './components/Dialogs';
import { DraftDialog } from './components/DraftDialog';
import { PathInspector } from './components/PathInspector';
import { buildClassificationDraft } from './domain/drafts';

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
  const [starting, setStarting] = useState(true);
  const [dialog, setDialog] = useState<
    'create' | 'rename' | 'projects' | 'move' | 'preview' | 'help' | 'draft' | null
  >(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [renameId, setRenameId] = useState('');
  const [records, setRecords] = useState<ProjectRecord[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [canvasRevision, setCanvasRevision] = useState(0);
  function notify(message: string) {
    setToast(message);
  }
  function replace(next: Workspace) {
    current.current = next;
    setState(next);
    if (parentId && !next.project.nodes[parentId]) setParentId(null);
    setSelected((old) => old.filter((id) => next.project.nodes[id]));
  }
  function edit(fn: (state: Workspace) => Workspace) {
    if (!current.current) return;
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
    if (!window.fileCanvas) return;
    return window.fileCanvas.onCloseRequested(() => {
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
        (event.target as HTMLElement).closest('input, textarea, [contenteditable]')
      )
        return;
      if (event.ctrlKey || event.metaKey) {
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
      if (event.key === 'F2' && selected.length === 1) {
        event.preventDefault();
        openRename(selected[0]);
      }
      if (event.key === 'Escape') setSelected([]);
    }
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [state, dialog, selected, parentId, busy]);
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openFolder() {
    void run(async () => {
      await persist();
      const project = unwrap(await window.fileCanvas.openRoot());
      if (project) {
        replace(workspace(project));
        setParentId(null);
        setSelected([]);
        setPreview(null);
        setExportPath(null);
        notify('已创建只读整理项目。原始文件不会被修改。');
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
    setParentId(id);
    setSelected([]);
  }
  function openCreate() {
    setName('新建文件夹');
    setNameError('');
    setDialog('create');
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
  return (
    <div className={`app-shell ${dialog ? 'has-dialog' : ''}`}>
      <div className="brandbar">
        <div className="brand">
          <span className="brand-mark">
            <Files size={19} />
          </span>
          <strong>FileCanvas</strong>
          <span className="brand-separator" />
          <span>文件整理演练台</span>
        </div>
        <div className="safe-badge">
          <ShieldCheck size={14} />
          安全 MVP · 原始文件只读
        </div>
        <button className="icon-button help" title="使用说明" onClick={() => setDialog('help')}>
          <Info size={18} />
        </button>
      </div>
      <header className="toolbar">
        <div className="toolbar-group">
          <button className="button" disabled={busy || starting} onClick={openFolder}>
            <FolderOpen size={16} />
            打开文件夹 / 新建项目
          </button>
          <button
            className="icon-button"
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
            <Files size={18} />
          </button>
          <button
            className="button subtle"
            disabled={!state || busy}
            onClick={() =>
              void persist()
                .then(() => notify('项目已保存至软件数据目录。'))
                .catch(() => {})
            }
          >
            <Save size={16} />
            保存
          </button>
        </div>
        <span className="toolbar-divider" />
        <div className="toolbar-group">
          <button
            className="icon-button"
            aria-label="撤销"
            title={`撤销 ${state?.past.at(-1)?.label ?? ''} (Ctrl+Z)`}
            disabled={!state?.past.length || busy}
            onClick={() => edit(undo)}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="重做"
            title="重做 (Ctrl+Y)"
            disabled={!state?.future.length || busy}
            onClick={() => edit(redo)}
          >
            <Redo2 size={18} />
          </button>
        </div>
        <div className="toolbar-spacer" />
        <button className="button demo-entry" disabled={busy || starting} onClick={openDemo}>
          <Play size={15} />
          体验示例
        </button>
        <button
          className="button"
          disabled={!state || busy}
          onClick={() =>
            void run(async () => {
              setPreview(unwrap(await window.fileCanvas.preview(current.current!.project)));
              setExportPath(null);
              setDialog('preview');
            })
          }
        >
          <ScanEye size={16} />
          预览变更{pendingCount > 0 && <span className="count-pill">{pendingCount}</span>}
        </button>
        <button
          className="button apply-disabled"
          disabled
          title="阶段一不提供真实文件修改；请先验收安全 MVP。"
        >
          <ShieldCheck size={16} />
          应用到硬盘<span>阶段二</span>
        </button>
      </header>
      {state ? (
        <main className="workspace">
          <Browser
            rootPath={state.project.rootPath}
            projectId={state.project.id}
            imported={imported}
            onImport={(paths) => add(paths)}
            notify={notify}
          />
          <section className="workarea">
            <div className="workspace-heading">
              <div>
                <div className="eyebrow">VIRTUAL WORKSPACE</div>
                <h1>
                  我的整理画布 <span className="tag">虚拟整理</span>
                </h1>
              </div>
              <div className="heading-actions">
                <button
                  className="button draft-entry"
                  onClick={() => setDialog('draft')}
                  disabled={busy}
                >
                  <Layers3 size={16} />
                  分类草案
                </button>
                <button className="button" onClick={openCreate} disabled={busy}>
                  <FolderPlus size={16} />
                  新建文件夹
                </button>
              </div>
            </div>
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
                  <button className={a.id === parentId ? 'active' : ''} onClick={() => enter(a.id)}>
                    {a.name}
                  </button>
                </span>
              ))}
            </div>
            <div className="virtual-banner">
              <ShieldCheck size={15} />
              <span>这里的移动与重命名只改变虚拟结构。画布位置独立保存，不影响硬盘路径。</span>
              <button
                className="text-button"
                onClick={() =>
                  void run(async () => {
                    unwrap(await window.fileCanvas.revealRoot());
                  })
                }
              >
                查看原文件夹
              </button>
            </div>
            {state.project.demo && (
              <div className="demo-guide">
                <span className="tag">演示副本 · 20 个真实样例</span>
                <span>① 生成分类草案 → ② 自由微调 → ③ 对照结构并导出方案</span>
                <small>再点“体验示例”会新建一份，不覆盖当前进度</small>
              </div>
            )}
            <PathInspector nodes={nodes} selected={selected} root={state.project.rootPath} />
            {selected.length > 0 && (
              <div className="selection-toolbar">
                <strong>已选择 {selected.length} 项</strong>
                <button className="text-button" onClick={() => setDialog('move')}>
                  <MoveRight size={14} />
                  移动到…
                </button>
                <button
                  className="text-button"
                  disabled={selected.length !== 1}
                  onClick={() => openRename(selected[0])}
                >
                  <Pencil size={14} />
                  重命名
                </button>
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
              parentId={parentId}
              selected={selected}
              onSelect={setSelected}
              onEnter={enter}
              onCreate={openCreate}
              onRename={openRename}
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
          <h1>先试着整理，再决定怎么放。</h1>
          <p>
            在自由画布中排列、归类和调整文件。
            <br />
            分类草案可以改，文件路径看得见，整理方案拿得走。
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
              预览目标路径
            </span>
          </div>
          <div className="welcome-note">
            <ShieldCheck size={15} />
            当前版本仅虚拟整理，真实文件始终保持原样。
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
      {(busy || starting) && (
        <div className="busy-overlay">
          <div>
            <LoaderCircle size={22} className="spin" />
            {starting ? '正在恢复项目…' : '正在读取与检查…'}
          </div>
        </div>
      )}
      {(dialog === 'create' || dialog === 'rename') && (
        <Modal
          title={dialog === 'create' ? '新建虚拟文件夹' : '重命名虚拟条目'}
          subtitle="仅修改虚拟整理项目，原始文件不会改变。"
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
                {dialog === 'create' ? '创建' : '确认重命名'}
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
        />
      )}
      {dialog === 'draft' && state && (
        <DraftDialog
          state={state}
          parentId={parentId}
          onClose={() => setDialog(null)}
          onAdopt={(mode) => {
            if (!current.current) return;
            const draft = buildClassificationDraft(current.current, parentId, mode);
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
            <p>1. 选择本地文件夹，左侧浏览始终只读。</p>
            <p>
              2. 勾选文件后加入画布，或直接拖到右侧。导入文件夹会读取整个子树，最多 5000
              项；遇到不安全条目时整批拒绝。
            </p>
            <p>
              3. 拖动卡片排列；拖进文件夹卡片改变归属；双击文件夹进入。多选可批量移动。F2
              重命名，Ctrl+Z / Ctrl+Y 撤销和重做。
            </p>
            <p>
              4. 自动保存包含虚拟结构与各层坐标，Ctrl+S
              手动保存。打开已保存项目可恢复进度；重启后撤销历史会重新开始。
            </p>
            <p>5. “预览变更”会检查源文件与目标路径。只导入的条目参与预览，未导入文件保持原状。</p>
            <p>
              6.
              “分类草案”按文件名与扩展名提出建议，采用后仍是虚拟结构；不确定的用途由你调整。预览中的“结构对照”可比较两棵树，并导出
              Markdown 方案到软件自己的 exports 目录。
            </p>
            <p>7. “体验示例”每次创建新的真实样例副本并自动加入画布，不会覆盖你已经保存的项目。</p>
            <p>
              程序不会对所选原始文件执行移动、重命名或删除。演示新副本、项目与导出方案写入软件自己的数据目录；真实应用与恢复仍未开放。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
