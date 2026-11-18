import {
  File,
  FileImage,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Music,
  Archive,
  FileCode2,
  FileSpreadsheet,
  Presentation,
  AppWindow,
  Palette,
  Type,
} from 'lucide-react';
import { fileInfo } from '../domain/file-info';
export { formatSize } from '../domain/file-info';

const ICONS = {
  image: FileImage,
  pdf: FileText,
  document: FileText,
  video: Film,
  audio: Music,
  archive: Archive,
  code: FileCode2,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  application: AppWindow,
  design: Palette,
  font: Type,
  generic: File,
};

export function FileIcon({
  name,
  folder = false,
  size = 32,
  open = false,
}: {
  name: string;
  folder?: boolean;
  size?: number;
  open?: boolean;
}) {
  const info = fileInfo(name);
  const large = size >= 28;
  const Icon = folder ? (open ? FolderOpen : Folder) : ICONS[info.tone as keyof typeof ICONS];
  return (
    <span
      className={`file-icon ${folder ? 'folder' : info.tone} ${large ? 'is-large' : ''}`}
      title={folder ? '文件夹' : info.description}
    >
      {folder && large ? (
        <svg width={size * 1.35} height={size} viewBox="0 0 64 48" aria-hidden="true">
          <path d="M4 10a5 5 0 0 1 5-5h15l6 6h25a5 5 0 0 1 5 5v25H4Z" fill="#e4a53f" />
          <path d="M9 14h45v25H9Z" fill="#fff8e5" />
          <path
            d="M5 19a4 4 0 0 1 4-4h46a5 5 0 0 1 5 6l-3 20a4 4 0 0 1-4 3H8a4 4 0 0 1-4-4Z"
            fill={open ? '#f8cf74' : '#f4c15d'}
            stroke="#d99a2b"
            strokeWidth="1.2"
          />
          <path d="M9 20h44" stroke="#ffe7ae" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <Icon
          size={size}
          strokeWidth={1.65}
          fill="currentColor"
          fillOpacity={folder ? 0.2 : 0.07}
          aria-hidden="true"
        />
      )}
      {large && !folder && (
        <span className="icon-extension" aria-hidden="true">
          {info.extension.slice(0, 5) || 'FILE'}
        </span>
      )}
    </span>
  );
}
