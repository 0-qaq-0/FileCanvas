import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Search,
  Plus,
  RefreshCw,
  FolderOpen,
  AlertCircle,
} from 'lucide-react';
import type { SourceEntry } from '../domain/types';
import { FileIcon, formatSize } from './FileIcon';

export function Browser({
  rootPath,
  projectId,
  imported,
  onImport,
  notify,
}: {
  rootPath: string;
  projectId: string;
  imported: Set<string>;
  onImport: (paths: string[]) => Promise<void>;
  notify: (message: string) => void;
}) {
  const [cache, setCache] = useState<Record<string, SourceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([rootPath]));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SourceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState('');
  const searchVersion = useRef(0);
  const generation = useRef(0);
  async function load(directory: string) {
    const current = generation.current;
    const response = await window.fileCanvas.listDirectory(directory);
    if (current !== generation.current) return;
    if (response.ok && response.data) {
      setCache((old) => ({ ...old, [directory]: response.data! }));
      setError('');
    } else {
      setError(response.error ?? '无法读取文件夹');
      notify(response.error ?? '无法读取文件夹');
    }
  }
  useEffect(() => {
    generation.current++;
    setCache({});
    setExpanded(new Set([rootPath]));
    setSelected(new Set());
    setQuery('');
    setError('');
    void load(rootPath);
    return () => {
      generation.current++;
      searchVersion.current++;
    };
  }, [rootPath, projectId]);
  useEffect(() => {
    const version = ++searchVersion.current;
    if (!query.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const response = await window.fileCanvas.search(query.trim());
      if (version !== searchVersion.current) return;
      setLoading(false);
      if (response.ok && response.data) {
        setResults(response.data.entries);
        setTruncated(response.data.truncated);
      } else notify(response.error ?? '搜索失败');
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);
  function toggle(entry: SourceEntry) {
    setExpanded((old) => {
      const next = new Set(old);
      next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path);
      return next;
    });
    if (!cache[entry.path]) void load(entry.path);
  }
  function row(entry: SourceEntry, depth: number) {
    const isExpanded = expanded.has(entry.path);
    return (
      <div key={entry.id}>
        <div
          className={`source-row ${selected.has(entry.path) ? 'chosen' : ''} ${entry.blocked ? 'blocked' : ''}`}
          style={{ paddingLeft: 10 + depth * 16 }}
          draggable={!entry.blocked}
          title={entry.blocked ? `${entry.path}\n${entry.blocked}` : entry.path}
          data-testid="source-row"
          data-name={entry.name}
          onClick={(event) => {
            if (entry.blocked) {
              notify(entry.blocked);
              return;
            }
            setSelected((old) => {
              const next = event.ctrlKey || event.metaKey ? new Set(old) : new Set<string>();
              next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path);
              return next;
            });
          }}
          onDoubleClick={() => entry.kind === 'folder' && !entry.blocked && toggle(entry)}
          onDragStart={(event) => {
            const paths = selected.has(entry.path) ? [...selected] : [entry.path];
            event.dataTransfer.setData('application/x-filecanvas-source', JSON.stringify(paths));
            event.dataTransfer.effectAllowed = 'copy';
            setSelected(new Set(paths));
          }}
        >
          <button
            className="tree-toggle"
            title={entry.kind === 'folder' ? '展开或折叠' : '文件'}
            tabIndex={entry.kind === 'folder' ? 0 : -1}
            disabled={!!entry.blocked || entry.kind !== 'folder'}
            onClick={(event) => {
              event.stopPropagation();
              toggle(entry);
            }}
          >
            {entry.kind === 'folder' ? (
              isExpanded ? (
                <ChevronDown size={13} />
              ) : (
                <ChevronRight size={13} />
              )
            ) : null}
          </button>
          <input
            aria-label={`选择 ${entry.name}`}
            type="checkbox"
            checked={selected.has(entry.path)}
            disabled={!!entry.blocked}
            onClick={(event) => event.stopPropagation()}
            onChange={() =>
              setSelected((old) => {
                const next = new Set(old);
                next.has(entry.path) ? next.delete(entry.path) : next.add(entry.path);
                return next;
              })
            }
          />
          <FileIcon name={entry.name} folder={entry.kind === 'folder'} size={18} />
          <div className="source-info">
            <span>{entry.name}</span>
            <small>
              {entry.blocked
                ? '不可访问'
                : entry.kind === 'folder'
                  ? '文件夹'
                  : `${entry.name.includes('.') ? entry.name.split('.').at(-1)?.toUpperCase() : '文件'} · ${formatSize(entry.size)}`}
            </small>
          </div>
          {entry.blocked ? (
            <AlertCircle size={13} />
          ) : imported.has(entry.id) ? (
            <span className="imported-dot" title="已加入画布" />
          ) : null}
        </div>
        {!query.trim() &&
          entry.kind === 'folder' &&
          isExpanded &&
          cache[entry.path]?.map((child) => row(child, depth + 1))}
      </div>
    );
  }
  return (
    <aside className="browser-panel">
      <div className="panel-title">
        <span>原始文件</span>
        <span className="tag neutral">只读浏览</span>
      </div>
      <div className="source-path" title={rootPath}>
        <FolderOpen size={17} />
        <span>{rootPath.split(/[\\/]/).filter(Boolean).at(-1)}</span>
        <button
          className="icon-button"
          title="刷新原始文件"
          onClick={() => {
            setCache({});
            setExpanded(new Set([rootPath]));
            void load(rootPath);
          }}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <label className="search-box">
        <Search size={15} />
        <input
          aria-label="搜索原始文件"
          placeholder="搜索项目内文件…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            aria-label="清空搜索"
            className="clear-search"
            onClick={() => setQuery('')}
            title="清空搜索"
          >
            ×
          </button>
        )}
      </label>
      <div className="browser-caption">
        {query
          ? loading
            ? '正在搜索…'
            : `搜索结果 · ${results.length}`
          : '展开目录，拖到右侧开始整理'}
      </div>
      <div className="file-tree">
        {error && <p className="inline-error">{error}</p>}
        {query.trim()
          ? !loading && results.map((e) => row(e, 0))
          : cache[rootPath]?.map((e) => row(e, 0))}
        {!error && !query && cache[rootPath]?.length === 0 && (
          <div className="quiet-empty">这个文件夹是空的</div>
        )}
        {query && !loading && !results.length && (
          <div className="quiet-empty">没有找到匹配文件</div>
        )}
        {query && truncated && (
          <p className="inline-error">
            搜索最多遍历 10000 项、返回 300 项；部分目录可能不可访问。请缩小范围。
          </p>
        )}
      </div>
      <div className="browser-footer">
        <span>已选择 {selected.size} 项</span>
        <button
          className="button small"
          disabled={!selected.size}
          onClick={() => void onImport([...selected])}
        >
          <Plus size={14} />
          加入画布
        </button>
      </div>
      <p className="browser-help">原始文件始终留在原处。加入文件夹会一并读取其子项。</p>
    </aside>
  );
}
