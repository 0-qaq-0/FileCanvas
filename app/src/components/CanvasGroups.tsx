import { useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronRight,
  Copy,
  FolderInput,
  Layers3,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import type { CanvasGroup } from '../domain/types';
import { ContextMenu } from './ContextMenu';
import type { MenuItem } from './ContextMenu';
import './canvas-groups.css';

export interface CanvasGroupActions {
  onOpen(file: string): void;
  onExport(id: string): void;
  onCopy(id: string): void;
  onCollect(id: string): void;
  onRename(id: string): void;
  onRemove(id: string, file?: string): void;
  onPrune(id: string): void;
}

interface Props extends CanvasGroupActions {
  groups: CanvasGroup[];
  dropTarget: string | null;
  // Lower-cased paths that could not be found on disk the last time they were checked.
  missing: Set<string>;
  // False where files cannot be dragged in (the list view).
  droppable?: boolean;
}

// A file set only records where files are; nothing in it moves a file. The strip says so once and
// keeps every action that touches the disk behind the set's own menu.
export function CanvasGroups({ groups, dropTarget, missing, droppable = true, ...actions }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  if (!groups.length) return null;
  const menuGroup = menu && groups.find((group) => group.id === menu.id);
  const lost = (group: CanvasGroup) =>
    group.files.filter((file) => missing.has(file.toLowerCase())).length;
  const items = (group: CanvasGroup): MenuItem[] => {
    const gone = lost(group);
    const present = group.files.length - gone;
    return [
      {
        label: '打包为 ZIP…',
        icon: <Archive size={14} />,
        disabled: !present,
        onClick: () => actions.onExport(group.id),
      },
      {
        label: '复制到文件夹…',
        hint: '原文件留在原处',
        icon: <Copy size={14} />,
        disabled: !present,
        onClick: () => actions.onCopy(group.id),
      },
      {
        label: '收进新文件夹',
        hint: '应用后才移动文件',
        icon: <FolderInput size={14} />,
        disabled: !present,
        onClick: () => actions.onCollect(group.id),
      },
      {
        label: '重命名',
        icon: <Pencil size={14} />,
        group: true,
        onClick: () => actions.onRename(group.id),
      },
      ...(gone
        ? [
            {
              label: `移除 ${gone} 个找不到的文件`,
              icon: <AlertTriangle size={14} />,
              onClick: () => actions.onPrune(group.id),
            },
          ]
        : []),
      {
        label: '删除文件集',
        hint: '不删除文件',
        icon: <Trash2 size={14} />,
        danger: true,
        group: true,
        onClick: () => actions.onRemove(group.id),
      },
    ];
  };
  return (
    <div
      className={`canvas-group-strip${collapsed ? ' is-collapsed' : ''}`}
      role="region"
      aria-label="文件集"
    >
      <button
        className="text-button canvas-group-toggle"
        aria-expanded={!collapsed}
        title={collapsed ? '展开文件集' : '收起文件集'}
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <Layers3 size={14} />
        文件集 {groups.length}
        <small>只记录位置，不移动文件</small>
      </button>
      {!collapsed &&
        groups.map((group) => {
          const gone = lost(group);
          return (
            <section
              key={group.id}
              aria-label={group.name}
              className={`canvas-group${dropTarget === group.id ? ' canvas-group-hover' : ''}`}
              data-canvas-group={droppable ? group.id : undefined}
            >
              <header className="canvas-group-header">
                <h3 title={group.name}>{group.name}</h3>
                <span className="canvas-group-count">{group.files.length}</span>
                <button
                  className="icon-button"
                  title="文件集操作"
                  aria-label={`${group.name} 的操作`}
                  aria-haspopup="menu"
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    setMenu({ id: group.id, x: box.left, y: box.bottom + 4 });
                  }}
                >
                  <MoreHorizontal size={14} />
                </button>
              </header>
              {gone > 0 && (
                <p className="canvas-group-warning" role="note">
                  <AlertTriangle size={12} /> {gone} 个文件找不到了，打包和复制时会跳过
                </p>
              )}
              {group.files.length ? (
                <ul className="canvas-group-files">
                  {group.files.map((file) => {
                    const name = file.split(/[\\/]/).at(-1);
                    const isMissing = missing.has(file.toLowerCase());
                    return (
                      <li key={file} className={isMissing ? 'is-missing' : undefined}>
                        <button
                          className="text-button canvas-group-file"
                          title={isMissing ? `找不到：${file}` : file}
                          disabled={isMissing}
                          onClick={() => actions.onOpen(file)}
                        >
                          {name}
                        </button>
                        <button
                          className="icon-button"
                          title="从文件集移除（不删除文件）"
                          aria-label={`从${group.name}移除 ${name}`}
                          onClick={() => actions.onRemove(group.id, file)}
                        >
                          <X size={12} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p>{droppable ? '把文件拖到这里，或右键文件选“加入”' : '右键文件选“加入”'}</p>
              )}
            </section>
          );
        })}
      {menu && menuGroup && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={menuGroup.name}
          label="文件集操作"
          items={items(menuGroup)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
