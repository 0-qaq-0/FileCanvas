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
} from 'lucide-react';
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
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  const Icon = folder
    ? open
      ? FolderOpen
      : Folder
    : /^(png|jpe?g|gif|webp|svg|bmp|heic)$/.test(extension)
      ? FileImage
      : /^(mp4|mov|avi|mkv)$/.test(extension)
        ? Film
        : /^(mp3|wav|flac)$/.test(extension)
          ? Music
          : /^(zip|rar|7z)$/.test(extension)
            ? Archive
            : /^(xlsx?|csv|tsv)$/.test(extension)
              ? FileSpreadsheet
              : /^(pptx?)$/.test(extension)
                ? Presentation
                : /^(js|ts|tsx|jsx|py|html|css|json|c|cpp|h|go|rs|java)$/.test(extension)
                  ? FileCode2
                  : /^(pdf|docx?|txt|md|xlsx?|pptx?)$/.test(extension)
                    ? FileText
                    : File;
  const color =
    !folder && extension === 'pdf'
      ? 'pdf'
      : folder
        ? 'folder'
        : Icon === FileImage
          ? 'image'
          : Icon === Film
            ? 'video'
            : Icon === FileText
              ? 'document'
              : Icon === FileSpreadsheet
                ? 'spreadsheet'
                : Icon === Presentation
                  ? 'presentation'
                  : Icon === Music
                    ? 'audio'
                    : Icon === Archive
                      ? 'archive'
                      : Icon === FileCode2
                        ? 'code'
                        : 'generic';
  return (
    <span
      className={`file-icon ${color}`}
      title={folder ? '文件夹' : extension ? `${extension.toUpperCase()} 文件` : '文件'}
    >
      <Icon
        size={size}
        strokeWidth={1.55}
        fill={folder ? 'currentColor' : 'none'}
        fillOpacity={folder ? 0.2 : 1}
      />
    </span>
  );
}
export function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
