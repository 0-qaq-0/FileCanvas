import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, LayoutGrid, MousePointer2, CornerUpLeft, Eye, FolderOpen } from 'lucide-react';
import type { CanvasNode, FileContent, NodeMap } from '../domain/types';
import { children } from '../domain/workspace';
import { FileIcon, formatSize } from './FileIcon';

interface Props {
  nodes: NodeMap;
  parentId: string | null;
  selected: string[];
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
}

function CardVisual({ node, nodes }: { node: CanvasNode; nodes: NodeMap }) {
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
  }, [node.id, node.source?.path]);
  if (node.kind === 'folder') {
    const children = Object.values(nodes).filter((n) => n.parentId === node.id);
    return (
      <div className="folder-visual">
        <FileIcon name={node.name} folder size={43} />
        <div>
          {children.slice(0, 2).map((n) => (
            <span key={n.id}>
              <FileIcon name={n.name} folder={n.kind === 'folder'} size={10} />
              {n.name}
            </span>
          ))}
          {!children.length && <span>拖文件到这里</span>}
        </div>
      </div>
    );
  }
  if (content?.kind === 'image')
    return <img className="card-thumbnail" src={content.dataUrl} alt="" draggable={false} />;
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
      origins: Record<string, { x: number; y: number }>;
      ids: string[];
      pointerId: number;
      moved: boolean;
    }
  | {
      type: 'box';
      x: number;
      y: number;
      currentX: number;
      currentY: number;
      startSelection: string[];
      pointerId: number;
    };
export function Canvas(props: Props) {
  const { nodes, parentId, selected, onSelect, onEnter, onLayout, onMove, onImport } = props;
  const container = useRef<HTMLDivElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const moved = useRef(false);
  const [draft, setDraft] = useState<Record<string, { x: number; y: number }>>({});
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const visible = useMemo(() => children(nodes, parentId), [nodes, parentId]);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const n of Object.values(nodes))
      if (n.parentId) result[n.parentId] = (result[n.parentId] ?? 0) + 1;
    return result;
  }, [nodes]);
  const [viewport, setViewport] = useState({ x: 0, y: 0, width: 1000, height: 700 });
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
    return () => observer.disconnect();
  }, []);
  const rendered = visible.filter((n) => {
    const p = draft[n.id] ?? n;
    return (
      p.x + 160 >= viewport.x - 180 &&
      p.x <= viewport.x + viewport.width + 180 &&
      p.y + 160 >= viewport.y - 180 &&
      p.y <= viewport.y + viewport.height + 180
    );
  });
  const width = Math.max(900, ...visible.map((n) => (draft[n.id]?.x ?? n.x) + 200));
  const height = Math.max(600, ...visible.map((n) => (draft[n.id]?.y ?? n.y) + 220));
  function point(event: { clientX: number; clientY: number }) {
    const rect = surface.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function begin(event: React.PointerEvent, node?: CanvasNode) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    moved.current = false;
    const p = point(event);
    if (node) {
      event.stopPropagation();
      const toggle = event.ctrlKey || event.metaKey || event.shiftKey;
      let ids = selected.includes(node.id) ? selected : toggle ? [...selected, node.id] : [node.id];
      if (toggle && selected.includes(node.id)) {
        onSelect(selected.filter((id) => id !== node.id));
        return;
      }
      ids = ids.filter((id) => nodes[id]?.parentId === parentId);
      onSelect(ids);
      gesture.current = {
        type: 'cards',
        startX: p.x,
        startY: p.y,
        ids,
        origins: Object.fromEntries(ids.map((id) => [id, { x: nodes[id].x, y: nodes[id].y }])),
        pointerId: event.pointerId,
        moved: false,
      };
    } else {
      if (!(event.ctrlKey || event.shiftKey)) onSelect([]);
      gesture.current = {
        type: 'box',
        x: p.x,
        y: p.y,
        currentX: p.x,
        currentY: p.y,
        startSelection: event.ctrlKey || event.shiftKey ? selected : [],
        pointerId: event.pointerId,
      };
    }
    if (!node) surface.current!.setPointerCapture(event.pointerId);
  }
  function update(event: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const p = point(event);
    if (g.type === 'cards') {
      const rawX = p.x - g.startX,
        rawY = p.y - g.startY;
      if (Math.abs(rawX) + Math.abs(rawY) < 5 && !g.moved) return;
      g.moved = true;
      moved.current = true;
      if (!surface.current!.hasPointerCapture(event.pointerId))
        surface.current!.setPointerCapture(event.pointerId);
      const dx = Math.min(
        49000 - Math.max(...Object.values(g.origins).map((o) => o.x)),
        Math.max(-Math.min(...Object.values(g.origins).map((o) => o.x)), rawX),
      );
      const dy = Math.min(
        49000 - Math.max(...Object.values(g.origins).map((o) => o.y)),
        Math.max(-Math.min(...Object.values(g.origins).map((o) => o.y)), rawY),
      );
      setDraft(
        Object.fromEntries(
          g.ids.map((id) => [
            id,
            { x: Math.round(g.origins[id].x + dx), y: Math.round(g.origins[id].y + dy) },
          ]),
        ),
      );
      const target = visible.find(
        (n) =>
          n.kind === 'folder' &&
          !g.ids.includes(n.id) &&
          p.x >= n.x &&
          p.x <= n.x + 136 &&
          p.y >= n.y &&
          p.y <= n.y + 138,
      );
      setHover(target?.id ?? null);
    } else {
      g.currentX = p.x;
      g.currentY = p.y;
      const rect = {
        x: Math.min(g.x, p.x),
        y: Math.min(g.y, p.y),
        w: Math.abs(g.x - p.x),
        h: Math.abs(g.y - p.y),
      };
      setBox(rect);
      onSelect([
        ...new Set([
          ...g.startSelection,
          ...visible
            .filter(
              (n) =>
                n.x < rect.x + rect.w &&
                n.x + 136 > rect.x &&
                n.y < rect.y + rect.h &&
                n.y + 138 > rect.y,
            )
            .map((n) => n.id),
        ]),
      ]);
    }
  }
  function finish(event: React.PointerEvent, canceled = false) {
    const g = gesture.current;
    if (!g) return;
    if (!canceled && g.type === 'cards' && g.moved) {
      // Read hit location again rather than relying on a render from the preceding event.
      const p = point(event);
      const target = visible.find(
        (n) =>
          n.kind === 'folder' &&
          !g.ids.includes(n.id) &&
          p.x >= n.x &&
          p.x <= n.x + 136 &&
          p.y >= n.y &&
          p.y <= n.y + 138,
      );
      if (target) onMove(g.ids, target.id);
      else {
        const rawX = p.x - g.startX,
          rawY = p.y - g.startY;
        const dx = Math.min(
          49000 - Math.max(...Object.values(g.origins).map((o) => o.x)),
          Math.max(-Math.min(...Object.values(g.origins).map((o) => o.x)), rawX),
        );
        const dy = Math.min(
          49000 - Math.max(...Object.values(g.origins).map((o) => o.y)),
          Math.max(-Math.min(...Object.values(g.origins).map((o) => o.y)), rawY),
        );
        onLayout(
          Object.fromEntries(
            g.ids.map((id) => [
              id,
              { x: Math.round(g.origins[id].x + dx), y: Math.round(g.origins[id].y + dy) },
            ]),
          ),
        );
      }
    }
    gesture.current = null;
    setDraft({});
    setBox(null);
    setHover(null);
    if (surface.current?.hasPointerCapture(event.pointerId))
      surface.current.releasePointerCapture(event.pointerId);
  }
  function arrange() {
    const columns = Math.max(
      1,
      Math.ceil(visible.length / 300),
      Math.floor(((container.current?.clientWidth ?? 900) - 64) / 156),
    );
    onLayout(
      Object.fromEntries(
        visible.map((n, i) => [
          n.id,
          { x: 32 + (i % columns) * 156, y: 32 + Math.floor(i / columns) * 156 },
        ]),
      ),
    );
  }
  return (
    <>
      <div className="canvas-tools">
        <span>
          <MousePointer2 size={13} />
          自由画布<span className="divider-dot">·</span>
          {visible.length} 项
        </span>
        <div>
          <button className="text-button" onClick={props.onBrowse}>
            <FolderOpen size={14} />
            添加文件
          </button>
          {parentId && (
            <button
              className="text-button"
              title="将选中项目移至上一级"
              disabled={!selected.length}
              onClick={() => onMove(selected, nodes[parentId].parentId)}
            >
              <CornerUpLeft size={14} />
              移至上级
            </button>
          )}
          <button className="text-button" disabled={!visible.length} onClick={arrange}>
            <LayoutGrid size={14} />
            排列整齐
          </button>
          <button className="text-button" onClick={props.onCreate}>
            <FolderPlus size={14} />
            虚拟文件夹
          </button>
        </div>
      </div>
      <div
        ref={container}
        onScroll={measure}
        className={`canvas-scroll ${dragOver ? 'external-drag' : ''}`}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-filecanvas-source')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const data = event.dataTransfer.getData('application/x-filecanvas-source');
          if (!data) return;
          try {
            const target = (event.target as HTMLElement)
              .closest('[data-folder-id]')
              ?.getAttribute('data-folder-id');
            const p = point(event);
            void onImport(JSON.parse(data), target ?? parentId, {
              x: Math.max(16, Math.min(p.x, 45000)),
              y: Math.max(16, Math.min(p.y, 45000)),
            });
          } catch {
            /* unsupported external drag is ignored */
          }
        }}
      >
        <div
          className="canvas-surface"
          ref={surface}
          style={{ width, height }}
          data-testid="canvas"
          onPointerDown={(event) => begin(event)}
          onPointerMove={update}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
        >
          {!visible.length && (
            <div className="canvas-empty">
              <div className="empty-illustration">
                <FileIcon name="" folder size={54} />
                <span>+</span>
              </div>
              <h2>{parentId ? '把文件放进这个文件夹' : '让文件，各归其位'}</h2>
              <p>
                点击“添加文件”展开文件栏，或先建一个虚拟文件夹。
                <br />
                放心尝试，每一步都只发生在画布里。
              </p>
              <button className="button" onClick={props.onCreate}>
                <FolderPlus size={16} />
                新建虚拟文件夹
              </button>
              <small>拖动排列 · 框选多选 · 双击进入文件夹</small>
            </div>
          )}
          {rendered.map((node) => (
            <div
              key={node.id}
              role="button"
              tabIndex={0}
              aria-label={`画布 ${node.name}`}
              aria-pressed={selected.includes(node.id)}
              data-testid="canvas-card"
              data-node-id={node.id}
              data-name={node.name}
              data-folder-id={node.kind === 'folder' ? node.id : undefined}
              className={`canvas-card ${selected.includes(node.id) ? 'selected' : ''} ${draft[node.id] ? 'dragging' : ''} ${hover === node.id ? 'drop-target' : ''}`}
              style={{ left: draft[node.id]?.x ?? node.x, top: draft[node.id]?.y ?? node.y }}
              onPointerDown={(event) => begin(event, node)}
              onClick={() => {
                if (!moved.current) props.onInspect(node.id);
              }}
              onDoubleClick={() =>
                node.kind === 'folder' ? onEnter(node.id) : props.onInspect(node.id)
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.stopPropagation();
                  node.kind === 'folder' ? onEnter(node.id) : props.onInspect(node.id);
                }
                if (event.key === ' ') {
                  event.preventDefault();
                  onSelect(event.ctrlKey ? [...selected, node.id] : [node.id]);
                }
              }}
            >
              <span className="card-type">
                {node.source
                  ? node.kind === 'folder'
                    ? '文件夹'
                    : node.name.split('.').at(-1)?.toUpperCase()
                  : '虚拟文件夹'}
              </span>
              <CardVisual node={node} nodes={nodes} />
              <span className="card-name" title={node.name}>
                {node.name}
              </span>
              <small>
                {node.kind === 'folder'
                  ? `${counts[node.id] ?? 0} 个子项`
                  : formatSize(node.source?.size ?? 0)}
              </small>
              <button
                className="card-preview-button"
                title={`预览 ${node.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect([node.id]);
                  props.onInspect(node.id);
                }}
              >
                <Eye size={13} />
              </button>
            </div>
          ))}
          {box && (
            <div
              className="selection-box"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            />
          )}
        </div>
      </div>
      <div className="canvas-hint">
        <span>单击预览 · 双击进入文件夹 · 拖入文件夹分类 · Ctrl / Shift 多选 · 空白处框选</span>
        <span>Ctrl+Z 撤销 / Ctrl+Y 重做</span>
      </div>
    </>
  );
}
