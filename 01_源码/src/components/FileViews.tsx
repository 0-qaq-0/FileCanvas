import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  Rows3,
  Search,
  X,
} from 'lucide-react';
import type { CanvasNode, NodeMap } from '../domain/types';
import type { FilterResult } from '../domain/filter';
import type { GroupBy, SortDir, SortKey, ViewMode } from '../domain/preferences';
import { GROUP_BYS, ICON_SCALE_STEP, SORT_KEYS } from '../domain/preferences';
import {
  formatModified,
  groupNodes,
  listRows,
  pendingLabel,
  sortNodes,
  typeLabel,
} from '../domain/listing';
import { children, isDescendant, topLevelSelection } from '../domain/workspace';
import { CardVisual } from './ExpandedCanvas';
import { FileIcon, formatSize } from './FileIcon';

const SORT_LABEL: Record<SortKey, string> = {
  name: '名称',
  type: '类型',
  size: '大小',
  modified: '修改时间',
};
const GROUP_LABEL: Record<GroupBy, string> = {
  type: '文件类型',
  month: '修改月份',
  status: '计划状态',
};
const VIEW_LABEL: Record<Exclude<ViewMode, 'canvas'>, string> = {
  tiles: '平铺',
  groups: '分组',
  list: '列表',
};
export const VIEW_ICON = { tiles: LayoutGrid, groups: Rows3, list: List } as const;

const NODES = 'application/x-filecanvas-nodes';
const SOURCE = 'application/x-filecanvas-source';
const ID_PREFIX = 'application/x-filecanvas-id-';
const accepts = (e: React.DragEvent) =>
  e.dataTransfer.types.some((t) => t === NODES || t === SOURCE || t.startsWith(ID_PREFIX));
function draggedIds(e: React.DragEvent): string[] {
  try {
    const ids = JSON.parse(e.dataTransfer.getData(NODES) || '[]') as string[];
    return ids.length
      ? ids
      : e.dataTransfer.types
          .filter((t) => t.startsWith(ID_PREFIX))
          .map((t) => t.slice(ID_PREFIX.length));
  } catch {
    return [];
  }
}

// A tile reads its preview only once it is near the visible area. Opening a folder with
// thousands of files must not fire thousands of reads or keep thousands of images in memory.
function useNear(
  root: React.RefObject<HTMLElement | null>,
): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNear(true);
        observer.disconnect();
      },
      { root: root.current, rootMargin: '300px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near];
}

function Tile({
  node,
  p,
  badge,
  subtitle,
  previews,
  root,
}: {
  node: CanvasNode;
  p: { className: string } & React.HTMLAttributes<HTMLDivElement>;
  badge: string;
  subtitle: string;
  previews: boolean;
  root: React.RefObject<HTMLElement | null>;
}) {
  const [ref, near] = useNear(root);
  const folder = node.kind === 'folder';
  return (
    <div
      ref={ref}
      {...p}
      className={`canvas-card tile ${folder ? 'is-folder' : ''} ${p.className}`}
    >
      <span className="card-type">
        {node.reviewDelete ? '待删除候选 · 未删除' : folder ? '文件夹' : typeLabel(node)}
      </span>
      {badge && <span className="pending-badge card-pending">{badge}</span>}
      <CardVisual node={node} previews={previews && near} />
      <span className="card-name" title={node.name}>
        {node.name}
      </span>
      <small>{subtitle}</small>
    </div>
  );
}

interface Props {
  mode: Exclude<ViewMode, 'canvas'>;
  nodes: NodeMap;
  rootPath: string;
  parentId: string | null;
  selected: string[];
  highlighted?: string | null;
  sortKey: SortKey;
  sortDir: SortDir;
  groupBy: GroupBy;
  onSort(key: SortKey, dir: SortDir): void;
  onGroupBy(by: GroupBy): void;
  zoom: number;
  previews: boolean;
  onZoom(scale: number): void;
  filter: string;
  filterResult: FilterResult | null;
  filterRef: React.RefObject<HTMLInputElement | null>;
  onFilterChange(query: string): void;
  onSelectMatches(): void;
  onSelect(ids: string[]): void;
  onEnter(id: string | null): void;
  onInspect(id: string): void;
  onOpen(id: string): void;
  onContextMenu(id: string, x: number, y: number): void;
  onMove(ids: string[], parentId: string | null): void;
  onImport(paths: string[], parentId: string | null): Promise<void>;
  onBrowse(): void;
  onCreate(): void;
}

// Tiles, groups and list: the same plan as the canvas, shown in a flat, sorted order. Clicking
// selects (and explains a file), double-click enters a folder or opens a file, dragging onto a
// folder moves, and the right-click menu is the canvas one. Positions on the canvas are never
// touched, so switching back finds every card where it was.
export function ListingView(props: Props) {
  const { mode, nodes, rootPath, parentId, selected, sortKey, sortDir } = props;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null | undefined>(undefined);
  const [focusId, setFocusId] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const dragging = useRef<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const latest = useRef({ zoom: props.zoom, onZoom: props.onZoom });
  latest.current = { zoom: props.zoom, onZoom: props.onZoom };

  const level = useMemo(
    () => sortNodes(children(nodes, parentId), sortKey, sortDir),
    [nodes, parentId, sortKey, sortDir],
  );
  const rows = useMemo(
    () => (mode === 'list' ? listRows(nodes, parentId, open, sortKey, sortDir) : []),
    [mode, nodes, parentId, open, sortKey, sortDir],
  );
  const sections = useMemo(
    () => (mode === 'groups' ? groupNodes(nodes, rootPath, level, props.groupBy) : []),
    [mode, nodes, rootPath, level, props.groupBy],
  );
  const visible: CanvasNode[] =
    mode === 'list'
      ? rows.map((r) => r.node)
      : mode === 'groups'
        ? sections.filter((s) => !collapsed.has(s.key)).flatMap((s) => s.items)
        : level;
  const ids = visible.map((n) => n.id);
  const tabStop = focusId && ids.includes(focusId) ? focusId : ids[0];
  const zoom = mode === 'list' ? 1 + (props.zoom - 1) * 0.5 : props.zoom;

  // Ctrl + wheel resizes like on the canvas (native listener: React's onWheel is passive).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let carried = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      carried += event.deltaY;
      if (Math.abs(carried) < 40) return;
      const direction = carried < 0 ? 1 : -1;
      carried = 0;
      latest.current.onZoom(latest.current.zoom + direction * ICON_SCALE_STEP);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  // A recommended destination is revealed: its folders open in the list, then it scrolls into view.
  useEffect(() => {
    const target = props.highlighted;
    if (!target || !nodes[target]) return;
    if (mode === 'list')
      setOpen((old) => {
        const next = new Set(old);
        for (let id = nodes[target].parentId; id && nodes[id]; id = nodes[id].parentId)
          if (id !== parentId) next.add(id);
        return next;
      });
    requestAnimationFrame(() =>
      scroller.current
        ?.querySelector(`[data-id="${CSS.escape(target)}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  }, [props.highlighted]);

  type Mods = { shiftKey: boolean; ctrlKey: boolean; metaKey?: boolean };
  function select(node: CanvasNode, event: Mods) {
    if (event.shiftKey && anchor.current && ids.includes(anchor.current)) {
      const a = ids.indexOf(anchor.current),
        b = ids.indexOf(node.id);
      props.onSelect(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else if (event.ctrlKey || event.metaKey) {
      anchor.current = node.id;
      props.onSelect(
        selected.includes(node.id)
          ? selected.filter((id) => id !== node.id)
          : [...selected, node.id],
      );
    } else {
      anchor.current = node.id;
      props.onSelect([node.id]);
      if (node.kind === 'file') props.onInspect(node.id);
    }
  }
  // The canvas never targets the items being moved or what they contain; neither do these.
  const blocked = (moving: string[], destination: string | null) =>
    destination !== null && moving.some((id) => isDescendant(nodes, destination, id));
  function drop(e: React.DragEvent, destination: string | null) {
    e.preventDefault();
    e.stopPropagation();
    setHover(undefined);
    const moving = draggedIds(e);
    if (moving.length) {
      if (blocked(moving, destination)) return;
      if (moving.some((id) => nodes[id] && nodes[id].parentId !== destination))
        props.onMove(moving, destination);
      return;
    }
    try {
      const paths = JSON.parse(e.dataTransfer.getData(SOURCE) || '[]') as string[];
      if (paths.length) void props.onImport(paths, destination);
    } catch {}
  }
  function over(e: React.DragEvent, destination: string | null) {
    if (!accepts(e)) return;
    if (blocked(dragging.current, destination)) {
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes(NODES) ? 'move' : 'copy';
    if (hover !== destination) setHover(destination);
  }
  // A folder takes what is dropped on it; a file stands for the level it sits in, so dropping
  // on a nested file moves into that folder and dropping on a top-level file moves out to the level.
  const target = (node: CanvasNode) => {
    const destination = node.kind === 'folder' ? node.id : node.parentId;
    return {
      onDragOver: (e: React.DragEvent) => over(e, destination),
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(undefined);
      },
      onDrop: (e: React.DragEvent) => drop(e, destination),
    };
  };
  function itemProps(node: CanvasNode) {
    const hit = !!props.filterResult?.matches.has(node.id),
      inside = props.filterResult?.inside.get(node.id) ?? 0,
      dim = !!props.filterResult && !hit && !inside;
    return {
      role: 'option' as const,
      'aria-selected': selected.includes(node.id),
      'aria-label': node.name,
      'data-testid': 'view-item',
      'data-id': node.id,
      'data-name': node.name,
      tabIndex: tabStop === node.id ? 0 : -1,
      draggable: true,
      className: [
        selected.includes(node.id) ? 'selected' : '',
        hover === node.id ? 'drop-target' : '',
        props.highlighted === node.id ? 'recommended-target' : '',
        dim ? 'dimmed' : '',
        hit ? 'filter-hit' : '',
      ].join(' '),
      onFocus: () => setFocusId(node.id),
      onClick: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;
        select(node, e);
      },
      onDoubleClick: (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;
        node.kind === 'folder' ? props.onEnter(node.id) : props.onOpen(node.id);
      },
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selected.includes(node.id)) props.onSelect([node.id]);
        props.onContextMenu(node.id, e.clientX, e.clientY);
      },
      onDragStart: (e: React.DragEvent) => {
        const base = selected.includes(node.id) ? selected : [node.id];
        if (!selected.includes(node.id)) props.onSelect([node.id]);
        const moving = topLevelSelection(nodes, base);
        dragging.current = moving;
        e.dataTransfer.setData(NODES, JSON.stringify(moving));
        e.dataTransfer.effectAllowed = 'copyMove';
      },
      onDragEnd: () => {
        dragging.current = [];
        setHover(undefined);
      },
      ...target(node),
    };
  }
  function keyboard(e: React.KeyboardEvent) {
    const current = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
    if (!current) return;
    const id = current.dataset.id!,
      node = nodes[id],
      index = ids.indexOf(id);
    const columns =
      mode === 'list'
        ? 1
        : Math.max(
            1,
            Array.from(current.parentElement?.children ?? []).filter(
              (c) => (c as HTMLElement).offsetTop === current.offsetTop,
            ).length,
          );
    let next = index;
    if (e.key === 'ArrowDown') next = index + columns;
    else if (e.key === 'ArrowUp') next = index - columns;
    else if (e.key === 'ArrowRight' && mode !== 'list') next = index + 1;
    else if (e.key === 'ArrowLeft' && mode !== 'list') next = index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    else if (e.key === 'ArrowRight' && mode === 'list' && node.kind === 'folder') {
      setOpen(new Set(open).add(id));
      e.preventDefault();
      return;
    } else if (e.key === 'ArrowLeft' && mode === 'list' && open.has(id)) {
      const closed = new Set(open);
      closed.delete(id);
      setOpen(closed);
      e.preventDefault();
      return;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      node.kind === 'folder' ? props.onEnter(id) : props.onInspect(id);
      return;
    } else if (e.key === ' ') {
      e.preventDefault();
      select(node, { ctrlKey: true, shiftKey: false });
      return;
    } else return;
    e.preventDefault();
    next = Math.max(0, Math.min(ids.length - 1, next));
    if (next === index) return;
    const to = nodes[ids[next]];
    scroller.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(to.id)}"]`)?.focus();
    if (e.shiftKey && anchor.current) select(to, e);
    else if (!e.ctrlKey) {
      anchor.current = to.id;
      props.onSelect([to.id]);
    }
  }

  const tile = (node: CanvasNode) => (
    <Tile
      key={node.id}
      node={node}
      p={itemProps(node)}
      badge={pendingLabel(nodes, rootPath, node)}
      subtitle={
        node.kind === 'folder'
          ? `${children(nodes, node.id).length} 个子项`
          : formatSize(node.source?.size ?? 0)
      }
      previews={props.previews}
      root={scroller}
    />
  );
  function head(key: SortKey) {
    const active = sortKey === key;
    return (
      <button
        type="button"
        className={`list-sort ${active ? 'active' : ''}`}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        onClick={() => props.onSort(key, active && sortDir === 'asc' ? 'desc' : 'asc')}
      >
        {SORT_LABEL[key]}
        {active && (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    );
  }
  const folderIds = Object.values(nodes)
    .filter(
      (n) =>
        n.kind === 'folder' &&
        n.id !== parentId &&
        (parentId === null || isDescendant(nodes, n.id, parentId)),
    )
    .slice(0, 200)
    .map((n) => n.id);
  const ModeIcon = VIEW_ICON[mode];
  const empty = !level.length;

  return (
    <>
      <div className="canvas-tools">
        <span>
          <ModeIcon size={13} />
          {VIEW_LABEL[mode]} · {level.length} 项
        </span>
        <div className="canvas-filter">
          <Search size={13} />
          <input
            ref={props.filterRef}
            aria-label="筛选当前层文件"
            placeholder="筛选文件名 (Ctrl+F)"
            value={props.filter}
            onChange={(e) => props.onFilterChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                props.onFilterChange('');
                e.currentTarget.blur();
              }
              if (e.key === 'Enter') props.onSelectMatches();
            }}
          />
          {props.filterResult && (
            <>
              <span className="filter-count">{props.filterResult.matches.size} 项匹配</span>
              <button
                className="text-button"
                disabled={!props.filterResult.matches.size}
                onClick={props.onSelectMatches}
              >
                选中匹配项
              </button>
            </>
          )}
          {props.filter && (
            <button
              className="icon-button"
              aria-label="清除筛选"
              onClick={() => props.onFilterChange('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div>
          {mode === 'groups' && (
            <label className="tool-select">
              分组
              <select
                aria-label="分组方式"
                value={props.groupBy}
                onChange={(e) => props.onGroupBy(e.target.value as GroupBy)}
              >
                {GROUP_BYS.map((by) => (
                  <option key={by} value={by}>
                    {GROUP_LABEL[by]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode !== 'list' && (
            <>
              <label className="tool-select">
                排序
                <select
                  aria-label="排序方式"
                  value={sortKey}
                  onChange={(e) => props.onSort(e.target.value as SortKey, sortDir)}
                >
                  {SORT_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {SORT_LABEL[key]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="icon-button"
                aria-label={sortDir === 'asc' ? '当前升序，点击改为降序' : '当前降序，点击改为升序'}
                title={sortDir === 'asc' ? '升序' : '降序'}
                onClick={() => props.onSort(sortKey, sortDir === 'asc' ? 'desc' : 'asc')}
              >
                {sortDir === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
              </button>
            </>
          )}
          {mode === 'list' && (
            <>
              <button className="text-button" onClick={() => setOpen(new Set(folderIds))}>
                <ChevronsUpDown size={14} />
                展开文件夹
              </button>
              <button className="text-button" onClick={() => setOpen(new Set())}>
                <ChevronsDownUp size={14} />
                全部收起
              </button>
            </>
          )}
          <button className="text-button" onClick={props.onBrowse}>
            <FolderOpen size={14} />
            添加文件
          </button>
        </div>
      </div>
      <div
        ref={scroller}
        className={`canvas-scroll listing-scroll ${hover === null ? 'external-drag' : ''}`}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('[data-id], button, select, label'))
            props.onSelect([]);
        }}
        onDragOver={(e) => over(e, parentId)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setHover(undefined);
        }}
        onDrop={(e) => drop(e, parentId)}
        onKeyDown={keyboard}
      >
        {empty ? (
          <div className="canvas-empty listing-empty">
            <FileIcon name="" folder size={54} />
            <h2>这一层还没有文件</h2>
            <p>添加文件，或把文件拖到这里。</p>
            <button className="button" onClick={props.onBrowse}>
              添加文件
            </button>
            <button className="button" onClick={props.onCreate}>
              <FolderPlus size={15} />
              新建虚拟文件夹
            </button>
          </div>
        ) : mode === 'tiles' ? (
          <div className="listing-zoom" style={{ zoom }}>
            <div
              className="tile-grid"
              role="listbox"
              aria-multiselectable="true"
              aria-label="文件平铺"
            >
              {level.map(tile)}
            </div>
          </div>
        ) : mode === 'groups' ? (
          <div className="listing-zoom" style={{ zoom }}>
            {sections.map((section) => {
              const closed = collapsed.has(section.key);
              return (
                <section className="tile-group" key={section.key} aria-label={section.label}>
                  <button
                    type="button"
                    className="group-head"
                    aria-expanded={!closed}
                    onClick={() => {
                      const next = new Set(collapsed);
                      closed ? next.delete(section.key) : next.add(section.key);
                      setCollapsed(next);
                    }}
                  >
                    {closed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                    <strong>{section.label}</strong>
                    <span>{section.items.length}</span>
                  </button>
                  {!closed && (
                    <div
                      className="tile-grid"
                      role="listbox"
                      aria-multiselectable="true"
                      aria-label={section.label}
                    >
                      {section.items.map(tile)}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <div className="listing-zoom list-wrap" style={{ zoom }}>
            <div className="list-head">
              <span className="col-name">{head('name')}</span>
              <span className="col-type">{head('type')}</span>
              <span className="col-size">{head('size')}</span>
              <span className="col-date">{head('modified')}</span>
              <span className="col-status">状态</span>
            </div>
            <div
              className="list-body"
              role="listbox"
              aria-multiselectable="true"
              aria-label="文件列表"
            >
              {rows.map(({ node, depth, expanded }) => {
                const p = itemProps(node);
                const badge = pendingLabel(nodes, rootPath, node);
                const folder = node.kind === 'folder';
                return (
                  <div
                    key={node.id}
                    {...p}
                    className={`list-row ${p.className}`}
                    data-depth={depth}
                    style={{ ['--depth' as string]: depth }}
                  >
                    <span className="col-name">
                      {folder ? (
                        <button
                          type="button"
                          className="row-toggle"
                          aria-label={expanded ? `收起 ${node.name}` : `展开 ${node.name}`}
                          aria-expanded={expanded}
                          onClick={() => {
                            const next = new Set(open);
                            expanded ? next.delete(node.id) : next.add(node.id);
                            setOpen(next);
                          }}
                        >
                          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      ) : (
                        <span className="row-toggle spacer" />
                      )}
                      <FileIcon name={node.name} folder={folder} open={expanded} size={18} />
                      <span className="row-name" title={node.name}>
                        {node.name}
                      </span>
                    </span>
                    <span className="col-type">{typeLabel(node)}</span>
                    <span className="col-size">
                      {folder
                        ? `${children(nodes, node.id).length} 项`
                        : formatSize(node.source?.size ?? 0)}
                    </span>
                    <span className="col-date">{formatModified(node.source?.mtimeMs)}</span>
                    <span className="col-status">
                      {badge && <span className="pending-badge">{badge}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      <div className="canvas-hint">
        <span>
          单击选择并查看内容 · 双击打开文件夹或文件 · 拖到文件夹上移动 · Ctrl / Shift 多选
        </span>
        <span>Ctrl+Z 撤销</span>
      </div>
    </>
  );
}
