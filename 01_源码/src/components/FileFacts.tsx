import type { CanvasNode } from '../domain/types';
import { fileInfo, folderDescription, folderSize, formatSize } from '../domain/file-info';
import type { FolderSummary } from '../domain/file-info';
import { FileIcon } from './FileIcon';

/** Main content types of a folder, left out when they only repeat the folder's own name. */
function folderTypes(summary: FolderSummary | undefined, name: string): string {
  const labels = (summary?.types ?? []).slice(0, 2).map(([label]) => label);
  return labels.length === 1 && labels[0] === name ? '' : labels.join(' / ');
}

export function FolderVisual({ summary, name = '' }: { summary?: FolderSummary; name?: string }) {
  const types = folderTypes(summary, name);
  return (
    <div className="folder-glance" title={summary && folderDescription(summary)}>
      <FileIcon name="" folder size={40} />
      {types && <span className="folder-types">{types}</span>}
    </div>
  );
}

// Folder totals cover only what is on the canvas; the tooltip says so instead of every card.
export function FileFacts({ node, summary }: { node: CanvasNode; summary?: FolderSummary }) {
  if (node.kind === 'folder' && summary)
    return (
      <small className="file-facts folder-facts" title={folderDescription(summary)}>
        {summary.files || summary.folders ? (
          <>
            <span>
              {summary.files} 个文件{summary.folders ? ` · ${summary.folders} 个文件夹` : ''}
            </span>
            <span className="fact-size">{folderSize(summary)}</span>
          </>
        ) : (
          <span>空文件夹</span>
        )}
      </small>
    );
  return (
    <small className="file-facts" title={fileInfo(node.name).description}>
      <span className="fact-size">{formatSize(node.source?.size)}</span>
    </small>
  );
}
