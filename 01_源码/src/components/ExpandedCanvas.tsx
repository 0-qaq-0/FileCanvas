import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import {
  GRID_STEP,
  arrangeItems,
  clampCoord,
  dropGrid,
  expandedLayout,
  folderAt,
  snapPositions,
} from '../domain/canvas-layout';
import type { ArrangeMode, Positions } from '../domain/canvas-layout';
import type { FilterResult } from '../domain/filter';
import { ICON_SCALE_STEP } from '../domain/preferences';
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
  onLayout(positions: Positions, label?: string): void;
  onMove(ids: string[], parentId: string | null, positions?: Positions): void;
  /** Dropped cards snap onto the grid; Alt while dragging inverts it. */
  snapToGrid?: boolean;
  onNotice?(message: string): void;
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
  /** Card size as a fraction of the standard size (see Preferences.iconScale). */
  zoom?: number;
  /** Off: cards show plain icons and nothing is read for thumbnails. */
  previews?: boolean;
  onZoom?(scale: number): void;
}
export function CardVisual({ node, previews }: { node: CanvasNode; previews: boolean }) {
  const [content, setContent] = useState<FileContent | null>(null);
  useEffect(() => {
    let active = true;
    if (previews && node.source && node.kind === 'file')
      window.fileCanvas
        .readContent(node.source.path)
        .then((r) => {
          if (active && r.ok && r.data) setContent(r.data);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [previews, node.id, node.source?.path, node.source?.mtimeMs]);
  if (node.kind === 'folder') return <FileIcon name={node.name} folder size={42} />;
  if (!previews) return <FileIcon name={node.name} size={39} />;
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
interface CardsGesture {
  type: 'cards';
  startX: number;
  startY: number;
  ids: string[];
  origins: Positions;
  pointerId: number;
  moved: boolean;
}
type Gesture =
  | CardsGesture
  | { type: 'box'; x: number; y: number; initial: string[]; pointerId: number };
export function Canvas(props: Props) {
  const { nodes, parentId, selected, onSelect, onLayout, onMove } = props;
  // All layout, hit-testing and dragging stay in canvas coordinates; the zoom only scales how
  // the surface is painted, and point() converts pointer positions back.
  const zoom = props.zoom ?? 1,
    previews = props.previews ?? true;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
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
    [dragOver, setDragOver] = useState(false),
    [snapping, setSnapping] = useState(false),
    [dragCount, setDragCount] = useState(0),
    // Most recently put-down cards, so a pile keeps the last one on top (not saved).
    [raised, setRaised] = useState<string[]>([]);
  const rank = useMemo(() => new Map(raised.map((id, i) => [id, i + 1])), [raised]);
  function raise(ids: string[]) {
    setRaised((old) => [...old.filter((id) => !ids.includes(id)), ...ids].slice(-90));
  }
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
        x: el.scrollLeft / zoomRef.current,
        y: el.scrollTop / zoomRef.current,
        width: el.clientWidth / zoomRef.current,
        height: el.clientHeight / zoomRef.current,
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
  const latest = useRef({ zoom, onZoom: props.onZoom });
  latest.current = { zoom, onZoom: props.onZoom };
  const previousZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = container.current;
    const before = previousZoom.current;
    previousZoom.current = zoom;
    if (!el || before === zoom) return;
    const centreX = (el.scrollLeft + el.clientWidth / 2) / before,
      centreY = (el.scrollTop + el.clientHeight / 2) / before;
    el.scrollLeft = el.scrollLeft === 0 ? 0 : centreX * zoom - el.clientWidth / 2;
    el.scrollTop = el.scrollTop === 0 ? 0 : centreY * zoom - el.clientHeight / 2;
    measure();
  }, [zoom]);
  // Ctrl + wheel changes the icon size like in a file manager. A native listener is needed:
  // React's onWheel is passive and could not stop the page from zooming.
  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let carried = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey || !latest.current.onZoom) return;
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
  const layout = useMemo(
      () => expandedLayout(nodes, parentId, expanded),
      [nodes, parentId, expanded],
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
          top: Math.max(0, r.y - 40) * zoom,
          left: Math.max(0, r.x - 24) * zoom,
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
    return { x: (event.clientX - r.left) / zoom, y: (event.clientY - r.top) / zoom };
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
  // Free placement is the default; the setting and the Alt key (which inverts it) only matter
  // when the cards are put down on this layer, never when they go into a folder.
  function shouldSnap(event: { altKey: boolean }, destination: string | null) {
    return destination === parentId && (props.snapToGrid ?? false) !== event.altKey;
  }
  function shiftFor(g: CardsGesture, dx: number, dy: number, snap: boolean) {
    if (!snap) return { x: dx, y: dy };
    const first = g.ids[0],
      snapped = snapPositions({
        [first]: { x: g.origins[first].x + dx, y: g.origins[first].y + dy },
      })[first];
    return { x: snapped.x - g.origins[first].x, y: snapped.y - g.origins[first].y };
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
      const destination = targetAt(p, g.ids),
        snap = shouldSnap(event, destination),
        shift = shiftFor(g, dx, dy, snap);
      setSnapping(snap);
      setDragCount(g.ids.length);
      setDraft(
        Object.fromEntries(
          Object.entries(g.origins).map(([id, r]) => [
            id,
            { x: Math.max(0, r.x + shift.x), y: Math.max(0, r.y + shift.y) },
          ]),
        ),
      );
      trackHover(destination);
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
      if (destination === parentId) {
        // Put down on the layer: every item stays exactly where it was released.
        const shift = shiftFor(g, p.x - g.startX, p.y - g.startY, shouldSnap(event, destination));
        const positions: Positions = Object.fromEntries(
          g.ids.map((id) => [
            id,
            { x: clampCoord(g.origins[id].x + shift.x), y: clampCoord(g.origins[id].y + shift.y) },
          ]),
        );
        raise(g.ids);
        if (g.ids.every((id) => nodes[id].parentId === destination)) onLayout(positions);
        else onMove(g.ids, destination, positions);
      } else if (g.ids.some((id) => nodes[id].parentId !== destination)) onMove(g.ids, destination);
      else {
        // Reordering inside an open folder: its files flow in order, so only the order changes.
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
              { x: 32 + (i % columns) * GRID_STEP, y: 32 + Math.floor(i / columns) * GRID_STEP },
            ]),
          ),
        );
      }
    }
    gesture.current = null;
    setDraft({});
    setSnapping(false);
    setDragCount(0);
    setBox(null);
    setHover(undefined);
    hoverId.current = null;
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (surface.current?.hasPointerCapture(event.pointerId))
      surface.current.releasePointerCapture(event.pointerId);
  }
  // Tidies this layer only. With a selection just those items are packed, starting from the
  // top-left of where they were; otherwise everything is. One undo step restores the old spots.
  function arrange(mode: ArrangeMode) {
    const layer = layout.filter((r) => nodes[r.id].parentId === parentId);
    const chosen = selected.length ? layer.filter((r) => selected.includes(r.id)) : layer;
    if (!chosen.length) {
      props.onNotice?.('没有可以排列的项目：请先选中画布上的卡片。');
      return;
    }
    const origin = selected.length
      ? { x: Math.min(...chosen.map((r) => r.x)), y: Math.min(...chosen.map((r) => r.y)) }
      : { x: 32, y: 32 };
    const positions = arrangeItems(
      chosen.map((r) => ({
        id: r.id,
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        name: nodes[r.id].name,
        folder: nodes[r.id].kind === 'folder',
      })),
      mode,
      origin,
      Math.max(600, viewport.width - origin.x - 32),
    );
    raise(chosen.map((r) => r.id));
    props.onLayout(positions, mode === 'type' ? '按类型排列' : '排列整齐');
    props.onNotice?.(
      `已${mode === 'type' ? '按类型排列' : '排列整齐'} ${chosen.length} 项${selected.length ? '（仅选中的）' : ''}，Ctrl+Z 可撤销。`,
    );
  }
  // Ctrl+A picks everything on this layer (or just the filter matches), the usual start of
  // "pile it all up, select, drop into a folder".
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"], .modal-backdrop')) return;
      event.preventDefault();
      if (props.filterResult?.matches.size) props.onSelectMatches();
      else onSelect(children(nodes, parentId).map((n) => n.id));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
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
          整理画布 · {layout.length} 项
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
          <button
            className="text-button"
            title={
              selected.length
                ? '只把选中的卡片排整齐，保持现在的顺序（Ctrl+Z 可撤销）'
                : '把这一层的卡片排整齐，保持现在的顺序（Ctrl+Z 可撤销）'
            }
            onClick={() => arrange('tidy')}
          >
            <LayoutGrid size={14} />
            {selected.length ? `排列所选 (${selected.length})` : '排列整齐'}
          </button>
          <button
            className="text-button"
            title="文件夹在前，相同类型的文件各占一行，方便框选后一起移走"
            onClick={() => arrange('type')}
          >
            按类型排列
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
            p = point(e),
            dest = targetAt(p, ids),
            // Dropped on this layer, the files land where the pointer was released.
            place = dest === parentId;
          if (ids.length) {
            const grid = dropGrid(ids, p);
            if (place) raise(ids);
            onMove(
              ids,
              dest,
              place ? (shouldSnap(e, dest) ? snapPositions(grid) : grid) : undefined,
            );
            return;
          }
          try {
            const paths = JSON.parse(
              e.dataTransfer.getData('application/x-filecanvas-source') || '[]',
            );
            if (paths.length) {
              const spot = dropGrid(['first'], p).first;
              void props.onImport(
                paths,
                dest,
                place
                  ? shouldSnap(e, dest)
                    ? snapPositions({ first: spot }).first
                    : spot
                  : undefined,
              );
            }
          } catch {}
        }}
      >
        {/* The wrapper takes the scaled size so the scroll area matches what is painted; clip
            (not hidden) keeps it from becoming the scroller of the sticky drop hint. */}
        <div
          className="canvas-zoom"
          style={{ width: width * zoom, height: height * zoom, overflow: 'clip' }}
        >
          <div
            className="canvas-surface"
            ref={surface}
            style={
              zoom === 1
                ? { width, height }
                : { width, height, transform: `scale(${zoom})`, transformOrigin: '0 0' }
            }
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
                  className={`${r.expanded ? 'folder-container' : 'canvas-card'} ${isFolder && !r.expanded ? 'is-folder' : ''} ${selected.includes(node.id) ? 'selected' : ''} ${draft[node.id] ? 'dragging' : ''} ${hover === node.id ? 'drop-target' : ''} ${props.highlighted === node.id ? 'recommended-target' : ''} ${dim ? 'dimmed' : ''} ${hit ? 'filter-hit' : ''}`}
                  style={{
                    left: p.x,
                    top: p.y,
                    width: r.width,
                    height: r.height,
                    // Loose cards stack by last touch; open containers sit above them.
                    zIndex: draft[node.id]
                      ? 1000 + r.depth
                      : r.depth === 0 && !r.expanded
                        ? 1 + (rank.get(node.id) ?? 0)
                        : 100 + r.depth * 3 + (r.expanded ? 0 : 1),
                  }}
                  onPointerDown={(e) => {
                    if (
                      !r.expanded ||
                      (e.target as HTMLElement).closest('.folder-container-heading')
                    )
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
                    if (
                      r.expanded &&
                      !(e.target as HTMLElement).closest('.folder-container-heading')
                    )
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
                        <button
                          title={`预览 ${node.name}`}
                          onClick={() => props.onInspect(node.id)}
                        >
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
                      {inside > 0 && !hit && (
                        <span className="filter-badge">含 {inside} 个匹配</span>
                      )}
                      <CardVisual node={node} previews={previews} />
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
                {hover === parentId
                  ? `放在松手的位置${snapping ? '（对齐网格）' : ''}`
                  : `放入：${hover ? relativeTarget(nodes, hover).join(' / ') : '项目根目录'}`}
                {dragCount > 1 && ` · ${dragCount} 项`}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="canvas-hint">
        <span>
          拖到哪放在哪 · 拖入文件夹即移入 · Ctrl+A 全选 · 拖动时按住 Alt 对齐网格 · Ctrl 多选
        </span>
        <span>Ctrl+Z 撤销</span>
      </div>
    </>
  );
}
