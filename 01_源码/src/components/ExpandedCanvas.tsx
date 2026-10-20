import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderPlus,
  LayoutGrid,
  MousePointer2,
  Eye,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Expand,
  ExternalLink,
  Home,
  Search,
  X,
} from 'lucide-react';
import type { CanvasNode, FileContent, NodeMap } from '../domain/types';
import { children, relativeTarget, topLevelSelection, isDescendant } from '../domain/workspace';
import { expandedLayout, folderAt } from '../domain/canvas-layout';
import type { FilterResult } from '../domain/filter';
import { FileIcon, formatSize } from './FileIcon';
interface Props {
  rootPath: string;
  initialExpanded?: string[];
  onExpandedChange?(ids: string[]): void;
  autoExpand?: boolean;
  nodes: NodeMap;
  parentId: string | null;
  selected: string[];
  highlighted?: string | null;
  onSelect(ids: string[]): void;
  onEnter(id: string | null): void;
  onLayout(positions: Record<string, { x: number; y: number }>): void;
  onMove(ids: string[], parentId: string | null): void;
  onImport(
    paths: string[],
    parentId: string | null,
    position?: { x: number; y: number },
  ): Promise<void>;
  onCreate(): void;
  onRename(id: string): void;
  onInspect(id: string): void;
  onBrowse(): void;
  onOpen(id: string): void;
  onContextMenu(id: string, x: number, y: number): void;
  filter: string;
  filterResult: FilterResult | null;
  filterRef: React.RefObject<HTMLInputElement | null>;
  onFilterChange(query: string): void;
  onSelectMatches(): void;
}
function CardVisual({ node }: { node: CanvasNode }) {
  const [content, setContent] = useState<FileContent | null>(null);
  useEffect(() => {
    let active = true;
    if (node.source && node.kind === 'file')
      window.fileCanvas
        .readContent(node.source.path)
        .then((r) => {
          if (active && r.ok && r.data) setContent(r.data);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [node.id, node.source?.path, node.source?.mtimeMs]);
  if (node.kind === 'folder') return <FileIcon name={node.name} folder size={42} />;
  if (content?.kind === 'image')
    return (
      <img
        className="card-thumbnail"
        src={content.dataUrl}
        alt=""
        draggable={false}
        onError={() => setContent({ kind: 'unsupported' })}
      />
    );
  if (content?.kind === 'text' && content.text)
    return (
      <div className="card-document">
        <FileIcon name={node.name} size={15} />
        <span>{content.text.slice(0, 90)}</span>
      </div>
    );
  return <FileIcon name={node.name} size={39} />;
}
type Gesture =
  | {
      type: 'cards';
      startX: number;
      startY: number;
      ids: string[];
      origins: Record<string, { x: number; y: number }>;
      pointerId: number;
      moved: boolean;
    }
  | { type: 'box'; x: number; y: number; initial: string[]; pointerId: number };
export function Canvas(props: Props) {
  const { nodes, parentId, selected, onSelect, onLayout, onMove } = props;
  const container = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null),
    moved = useRef(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    hoverId = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
      new Set(
        props.initialExpanded ??
          (props.autoExpand
            ? children(nodes, parentId)
                .filter((n) => n.kind === 'folder')
                .map((n) => n.id)
            : []),
      ),
    ),
    [draft, setDraft] = useState<Record<string, { x: number; y: number }>>({});
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null),
    [hover, setHover] = useState<string | null | undefined>(undefined),
    [dragOver, setDragOver] = useState(false);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 1000, height: 700 });
  useEffect(() => {
    props.onExpandedChange?.([...expanded].filter((id) => nodes[id]?.kind === 'folder'));
  }, [expanded]);
  function pendingLabel(node: CanvasNode) {
    if (!node.source) return '待新建';
    const target = `${props.rootPath.replace(/[\\/]+$/, '')}\\${relativeTarget(nodes, node.id).join('\\')}`;
    if (target === node.source.path) return '';
    return node.name !== node.source.name ? '待改名 / 移动' : '待移动';
  }
  function measure() {
    const el = container.current;
    if (el)
      setViewport({
        x: el.scrollLeft,
        y: el.scrollTop,
        width: el.clientWidth,
        height: el.clientHeight,
      });
  }
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (container.current) observer.observe(container.current);
    measure();
    return () => {
      observer.disconnect();
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);
  const layout = useMemo(
      () => expandedLayout(nodes, parentId, expanded, viewport.width),
      [nodes, parentId, expanded, viewport.width],
    ),
    byId = new Map(layout.map((r) => [r.id, r]));
  useEffect(() => {
    if (props.highlighted && nodes[props.highlighted])
      setExpanded((old) => {
        const next = new Set(old);
        let id: string | null = props.highlighted!;
        while (id && nodes[id]) {
          next.add(id);
          id = nodes[id].parentId;
        }
        return next;
      });
  }, [props.highlighted]);
  useEffect(() => {
    if (props.highlighted) {
      const r = byId.get(props.highlighted);
      if (r && container.current)
        container.current.scrollTo({
          top: Math.max(0, r.y - 40),
          left: Math.max(0, r.x - 24),
          behavior: 'smooth',
        });
    }
  }, [props.highlighted, expanded]);
  const rendered = layout.filter((r) => {
    const p = draft[r.id] ?? r;
    return (
      p.x + r.width >= viewport.x - 180 &&
      p.x <= viewport.x + viewport.width + 180 &&
      p.y + r.height >= viewport.y - 180 &&
      p.y <= viewport.y + viewport.height + 180
    );
  });
  const width = Math.max(
    viewport.width - 1,
    600,
    ...layout.map((r) => r.x + r.width + 40),
    ...Object.values(draft).map((r) => r.x + 180),
  );
  useEffect(() => {
    setExpanded((old) => {
      const next = new Set([...old].filter((id) => nodes[id]?.kind === 'folder'));
      return next.size === old.size ? old : next;
    });
  }, [nodes]);
  const height = Math.max(
    viewport.height - 1,
    500,
    ...layout.map((r) => r.y + r.height + 80),
    ...Object.values(draft).map((r) => r.y + 180),
  );
  function point(event: { clientX: number; clientY: number }) {
    const r = surface.current!.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }
  function toggle(id: string) {
    setExpanded((old) => {
      const next = new Set(old);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function begin(event: React.PointerEvent, node?: CanvasNode) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    moved.current = false;
    const p = point(event);
    if (node) {
      event.stopPropagation();
      const additive = event.ctrlKey || event.metaKey || event.shiftKey;
      if (additive && selected.includes(node.id)) {
        onSelect(selected.filter((id) => id !== node.id));
        return;
      }
      const ids = topLevelSelection(
        nodes,
        selected.includes(node.id) ? selected : additive ? [...selected, node.id] : [node.id],
      ).filter((id) => byId.has(id));
      onSelect(ids);
      const visualIds = layout
        .filter((r) => ids.some((id) => isDescendant(nodes, r.id, id)))
        .map((r) => r.id);
      gesture.current = {
        type: 'cards',
        startX: p.x,
        startY: p.y,
        ids,
        origins: Object.fromEntries(
          visualIds.map((id) => [id, { x: byId.get(id)!.x, y: byId.get(id)!.y }]),
        ),
        pointerId: event.pointerId,
        moved: false,
      };
    } else {
      if (!event.ctrlKey && !event.shiftKey) onSelect([]);
      gesture.current = {
        type: 'box',
        x: p.x,
        y: p.y,
        initial: event.ctrlKey || event.shiftKey ? selected : [],
        pointerId: event.pointerId,
      };
    }
    if (!node) surface.current!.setPointerCapture(event.pointerId);
  }
  function targetAt(p: { x: number; y: number }, ids: string[]) {
    return folderAt(nodes, layout, p, ids) ?? parentId;
  }
  function trackHover(id: string | null) {
    setHover(id);
    if (hoverId.current === id) return;
    hoverId.current = id;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (id && !expanded.has(id))
      hoverTimer.current = setTimeout(() => setExpanded((old) => new Set([...old, id])), 650);
  }
  function update(event: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const p = point(event);
    if (g.type === 'cards') {
      const dx = p.x - g.startX,
        dy = p.y - g.startY;
      if (!g.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
      g.moved = true;
      moved.current = true;
      if (!surface.current!.hasPointerCapture(event.pointerId))
        surface.current!.setPointerCapture(event.pointerId);
      setDraft(
        Object.fromEntries(
          Object.entries(g.origins).map(([id, r]) => [
            id,
            { x: Math.max(0, r.x + dx), y: Math.max(0, r.y + dy) },
          ]),
        ),
      );
      trackHover(targetAt(p, g.ids));
    } else {
      const rect = {
        x: Math.min(g.x, p.x),
        y: Math.min(g.y, p.y),
        w: Math.abs(g.x - p.x),
        h: Math.abs(g.y - p.y),
      };
      setBox(rect);
      onSelect([
        ...new Set([
          ...g.initial,
          ...layout
            .filter(
              (r) =>
                !r.expanded &&
                r.x < rect.x + rect.w &&
                r.x + r.width > rect.x &&
                r.y < rect.y + rect.h &&
                r.y + r.height > rect.y,
            )
            .map((r) => r.id),
        ]),
      ]);
    }
  }
  function finish(event: React.PointerEvent, canceled = false) {
    const bounds = container.current?.getBoundingClientRect();
    if (
      bounds &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    )
      canceled = true;
    const g = gesture.current;
    if (g && !canceled && g.type === 'cards' && g.moved) {
      const p = point(event),
        destination = targetAt(p, g.ids);
      if (g.ids.some((id) => nodes[id].parentId !== destination)) onMove(g.ids, destination);
      else if (!expanded.size)
        onLayout(
          Object.fromEntries(
            g.ids.map((id) => [
              id,
              {
                x: Math.round(Math.max(0, Math.min(49000, g.origins[id].x + p.x - g.startX))),
                y: Math.round(Math.max(0, Math.min(49000, g.origins[id].y + p.y - g.startY))),
              },
            ]),
          ),
        );
      else {
        const peers = layout
          .filter((r) => nodes[r.id].parentId === destination && !g.ids.includes(r.id))
          .sort((a, b) => a.y - b.y || a.x - b.x);
        let index = peers.findIndex((r) => p.y < r.y + r.height / 2 && p.x < r.x + r.width);
        if (index < 0) index = peers.length;
        const order = peers.map((r) => r.id);
        order.splice(index, 0, ...g.ids);
        const columns = Math.max(5, Math.ceil(order.length / 300));
        onLayout(
          Object.fromEntries(
            order.map((id, i) => [
              id,
              { x: 32 + (i % columns) * 156, y: 32 + Math.floor(i / columns) * 156 },
            ]),
          ),
        );
      }
    }
    gesture.current = null;
    setDraft({});
    setBox(null);
    setHover(undefined);
    hoverId.current = null;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (surface.current?.hasPointerCapture(event.pointerId))
      surface.current.releasePointerCapture(event.pointerId);
  }
  function arrange() {
    const columns = Math.max(
      1,
      Math.ceil(children(nodes, parentId).length / 300),
      Math.floor((viewport.width - 64) / 156),
    );
    onLayout(
      Object.fromEntries(
        children(nodes, parentId).map((n, i) => [
          n.id,
          { x: 32 + (i % columns) * 156, y: 32 + Math.floor(i / columns) * 156 },
        ]),
      ),
    );
  }
  function externalIds(e: React.DragEvent) {
    try {
      const ids = JSON.parse(
        e.dataTransfer.getData('application/x-filecanvas-nodes') || '[]',
      ) as string[];
      return ids.length
        ? ids
        : e.dataTransfer.types
            .filter((t) => t.startsWith('application/x-filecanvas-id-'))
            .map((t) => t.slice('application/x-filecanvas-id-'.length));
    } catch {
      return [];
    }
  }
  return (
    <>
      <div className="canvas-tools">
        <span>
          <MousePointer2 size={13} />
          {expanded.size ? '展开式整理 · 自动排布' : '整理画布'} · {layout.length} 项
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
          <button
            className="text-button"
            onClick={() =>
              setExpanded(
                new Set(
                  Object.values(nodes)
                    .filter((n) => n.kind === 'folder')
                    .slice(0, 100)
                    .map((n) => n.id),
                ),
              )
            }
          >
            展开文件夹
          </button>
          <button className="text-button" onClick={() => setExpanded(new Set())}>
            全部收起
          </button>
          <button className="text-button" onClick={props.onBrowse}>
            <FolderOpen size={14} />
            添加文件
          </button>
          <button className="text-button" onClick={arrange}>
            <LayoutGrid size={14} />
            排列整齐
          </button>
        </div>
      </div>
      <div
        ref={container}
        onScroll={measure}
        className={`canvas-scroll ${dragOver ? 'external-drag' : ''}`}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.some((t) =>
              ['application/x-filecanvas-source', 'application/x-filecanvas-nodes'].includes(t),
            )
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = e.dataTransfer.types.includes(
              'application/x-filecanvas-nodes',
            )
              ? 'move'
              : 'copy';
            setDragOver(true);
            trackHover(targetAt(point(e), externalIds(e)));
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDragOver(false);
            setHover(undefined);
            hoverId.current = null;
            if (hoverTimer.current) clearTimeout(hoverTimer.current);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          setHover(undefined);
          hoverId.current = null;
          if (hoverTimer.current) clearTimeout(hoverTimer.current);
          const ids = externalIds(e),
            dest = targetAt(point(e), ids);
          if (ids.length) {
            onMove(ids, dest);
            return;
          }
          try {
            const paths = JSON.parse(
              e.dataTransfer.getData('application/x-filecanvas-source') || '[]',
            );
            if (paths.length) void props.onImport(paths, dest);
          } catch {}
        }}
      >
        <div
          className="canvas-surface"
          ref={surface}
          style={{ width, height }}
          data-testid="canvas"
          onPointerDown={(e) => begin(e)}
          onPointerMove={update}
          onPointerUp={(e) => finish(e)}
          onPointerCancel={(e) => finish(e, true)}
        >
          <div className={`root-drop-label ${hover === parentId ? 'receiving' : ''}`}>
            <Home size={13} />
            {parentId ? nodes[parentId]?.name : '项目根目录'} <span>拖到容器外，放回这里</span>
          </div>
          {!layout.length && (
            <div className="canvas-empty">
              <FileIcon name="" folder size={54} />
              <h2>把文件放到画布上</h2>
              <p>添加文件，展开文件夹，直接拖动整理。</p>
              <button className="button" onClick={props.onBrowse}>
                添加文件
              </button>
              <button className="button" onClick={props.onCreate}>
                <FolderPlus size={15} />
                新建虚拟文件夹
              </button>
            </div>
          )}
          {rendered.map((r) => {
            const node = nodes[r.id],
              p = draft[r.id] ?? r,
              isFolder = node.kind === 'folder';
            const hit = !!props.filterResult?.matches.has(node.id),
              inside = props.filterResult?.inside.get(node.id) ?? 0,
              dim = !!props.filterResult && !hit && !inside;
            return (
              <div
                key={node.id}
                role={r.expanded ? 'group' : 'button'}
                tabIndex={0}
                aria-label={`画布 ${node.name}`}
                aria-pressed={!r.expanded ? selected.includes(node.id) : undefined}
                data-testid="canvas-card"
                data-node-id={node.id}
                data-name={node.name}
                data-expanded={r.expanded}
                data-folder-id={isFolder ? node.id : undefined}
                className={`${r.expanded ? 'folder-container' : 'canvas-card'} ${selected.includes(node.id) ? 'selected' : ''} ${draft[node.id] ? 'dragging' : ''} ${hover === node.id ? 'drop-target' : ''} ${props.highlighted === node.id ? 'recommended-target' : ''} ${dim ? 'dimmed' : ''} ${hit ? 'filter-hit' : ''}`}
                style={{
                  left: p.x,
                  top: p.y,
                  width: r.width,
                  height: r.height,
                  zIndex: draft[node.id] ? 100 + r.depth : 1 + r.depth * 3,
                }}
                onPointerDown={(e) => {
                  if (!r.expanded || (e.target as HTMLElement).closest('.folder-container-heading'))
                    begin(e, node);
                }}
                onClick={(e) => {
                  if (
                    (e.target as HTMLElement).closest('button') ||
                    moved.current ||
                    e.ctrlKey ||
                    e.shiftKey
                  )
                    return;
                  if (isFolder && !r.expanded) toggle(node.id);
                  else if (!r.expanded) props.onInspect(node.id);
                }}
                onDoubleClick={() => {
                  if (!isFolder && !moved.current) props.onOpen(node.id);
                }}
                onContextMenu={(e) => {
                  // Expanded folders only answer on their heading; cards anywhere.
                  if (r.expanded && !(e.target as HTMLElement).closest('.folder-container-heading'))
                    return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (!selected.includes(node.id)) onSelect([node.id]);
                  props.onContextMenu(node.id, e.clientX, e.clientY);
                }}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    isFolder ? toggle(node.id) : props.onInspect(node.id);
                  }
                  if (e.key === ' ') {
                    e.preventDefault();
                    onSelect(e.ctrlKey ? [...selected, node.id] : [node.id]);
                  }
                }}
              >
                {r.expanded ? (
                  <>
                    <div className="folder-container-heading">
                      <button
                        aria-label={`收起 ${node.name}`}
                        title="收起此文件夹"
                        onClick={() => toggle(node.id)}
                      >
                        <ChevronDown size={15} />
                      </button>
                      <FileIcon name={node.name} folder open size={19} />
                      <strong>{node.name}</strong>
                      {pendingLabel(node) && (
                        <span className="pending-badge">{pendingLabel(node)}</span>
                      )}
                      <small>{children(nodes, node.id).length}</small>
                      <button title={`预览 ${node.name}`} onClick={() => props.onInspect(node.id)}>
                        <Eye size={14} />
                      </button>
                      <button
                        title={`单独查看 ${node.name}`}
                        onClick={() => props.onEnter(node.id)}
                      >
                        <Expand size={14} />
                      </button>
                    </div>
                    <div className="folder-container-caption">
                      {children(nodes, node.id).length
                        ? '内部文件可直接拖入、拖出'
                        : '拖文件到这里'}
                    </div>
                  </>
                ) : (
                  <>
                    <span className="card-type">
                      {node.reviewDelete
                        ? '待删除候选 · 未删除'
                        : isFolder
                          ? '点击展开'
                          : node.name.split('.').at(-1)?.toUpperCase()}
                    </span>
                    {pendingLabel(node) && (
                      <span className="pending-badge card-pending">{pendingLabel(node)}</span>
                    )}
                    {inside > 0 && !hit && <span className="filter-badge">含 {inside} 个匹配</span>}
                    <CardVisual node={node} />
                    <span className="card-name" title={node.name}>
                      {node.name}
                    </span>
                    <small>
                      {isFolder
                        ? `${children(nodes, node.id).length} 个子项`
                        : formatSize(node.source?.size ?? 0)}
                    </small>
                    <button
                      className="card-preview-button"
                      title={isFolder ? `展开 ${node.name}` : `预览 ${node.name}`}
                      onClick={() => {
                        onSelect([node.id]);
                        isFolder ? toggle(node.id) : props.onInspect(node.id);
                      }}
                    >
                      {isFolder ? <ChevronRight size={13} /> : <Eye size={13} />}
                    </button>
                    {!isFolder && (
                      <button
                        className="card-open-button"
                        title={`用系统应用打开 ${node.name}`}
                        onClick={() => props.onOpen(node.id)}
                      >
                        <ExternalLink size={12} />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
          {box && (
            <div
              className="selection-box"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            />
          )}
          {hover !== undefined && (
            <div className="drop-destination" role="status">
              放入：{hover ? relativeTarget(nodes, hover).join(' / ') : '项目根目录'}
            </div>
          )}
        </div>
      </div>
      <div className="canvas-hint">
        <span>
          点击文件夹展开 · 点文件看解释 · 双击用系统应用打开 · 容器之间直接拖动 · Ctrl 多选
        </span>
        <span>Ctrl+Z 撤销</span>
      </div>
    </>
  );
}
