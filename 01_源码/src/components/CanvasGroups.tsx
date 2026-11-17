import { Archive, X } from 'lucide-react';
import type { CanvasGroup } from '../domain/types';
import './canvas-groups.css';

interface Props {
  groups: CanvasGroup[];
  dropTarget: string | null;
  onOpen(file: string): void;
  onExport(id: string): void;
  onRemove(id: string, file?: string): void;
}

export function CanvasGroups({ groups, dropTarget, onOpen, onExport, onRemove }: Props) {
  if (!groups.length) return null;
  return (
    <div className="canvas-group-strip" role="region" aria-label="画布分组">
      {groups.map((group) => (
        <section
          key={group.id}
          aria-label={group.name}
          className={`canvas-group${dropTarget === group.id ? ' canvas-group-hover' : ''}`}
          data-canvas-group={group.id}
        >
          <header className="canvas-group-header">
            <h3 title={group.name}>{group.name}</h3>
            <button
              className="text-button"
              disabled={!group.files.length}
              aria-label={`打包 ${group.name}`}
              onClick={() => onExport(group.id)}
            >
              <Archive size={14} /> 打包
            </button>
            <button
              className="icon-button"
              title="移除分组"
              aria-label={`移除分组 ${group.name}`}
              onClick={() => onRemove(group.id)}
            >
              <X size={14} />
            </button>
          </header>
          {group.files.length ? (
            <ul className="canvas-group-files">
              {group.files.map((file) => {
                const name = file.split(/[\\/]/).at(-1);
                return (
                  <li key={file}>
                    <button
                      className="text-button canvas-group-file"
                      title={file}
                      onClick={() => onOpen(file)}
                    >
                      {name}
                    </button>
                    <button
                      className="icon-button"
                      title="从组中移除"
                      aria-label={`从${group.name}移除 ${name}`}
                      onClick={() => onRemove(group.id, file)}
                    >
                      <X size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p>把文件拖到这里</p>
          )}
        </section>
      ))}
    </div>
  );
}
