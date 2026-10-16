import {
  File,
  FileImage,
  FileText,
  Film,
  Folder,
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
}: {
  name: string;
  folder?: boolean;
  size?: number;
}) {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  const Icon = folder
    ? Folder
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
  const color = folder
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
    <span className={`file-icon ${color}`}>
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
