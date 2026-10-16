import fs from 'node:fs/promises';
import path from 'node:path';
import { readEntry } from './filesystem';
import type { FileContent } from '../src/domain/types';

export const TEXT_EXT =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|log|xml|html|css|scss|[cm]?[jt]sx?|py|c|cpp|h|hpp|java|rs|go|sql|sh|ps1)$/i;
export function excluded(relative: string): boolean {
  return relative
    .split(/[\\/]/)
    .some(
      (part) =>
        part.startsWith('.') ||
        /^(node_modules|dist|build|vendor|coverage|__pycache__|06_构建产物|07_发布成品)$/i.test(
          part,
        ) ||
        /^(credentials?|secrets?|tokens?|passwords?)([._-]|$)/i.test(part) ||
        /\.(pem|key|pfx|p12|kdbx)$/i.test(part),
    );
}
export async function readContent(root: string, input: string, image = true): Promise<FileContent> {
  const entry = await readEntry(root, input);
  if (entry.kind !== 'file')
    return { kind: 'unsupported', message: '请选择文件，文件夹内容在画布和列表中查看。' };
  if (excluded(path.relative(root, entry.path)))
    return { kind: 'unsupported', message: '隐藏文件、密钥及构建目录不读取正文。' };
  const mime: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
  };
  const ext = path.extname(entry.name).toLowerCase();
  if (image && mime[ext]) {
    if (entry.size > 5 * 1024 * 1024)
      return { kind: 'unsupported', message: '图片超过 5 MB，暂不生成预览。' };
    return {
      kind: 'image',
      dataUrl: `data:${mime[ext]};base64,${(await fs.readFile(entry.path)).toString('base64')}`,
    };
  }
  if (!TEXT_EXT.test(entry.name))
    return {
      kind: 'unsupported',
      message:
        '此格式暂未提取正文。PDF、Office、音视频及压缩包目前只提供文件信息，AI 不会读取其内容。',
    };
  const file = await fs.open(entry.path, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(entry.size, 256 * 1024));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    let text: string;
    try {
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : 'utf-8';
      text = new TextDecoder(encoding, { fatal: true })
        .decode(bytes, { stream: entry.size > bytesRead })
        .replace(/^\uFEFF/, '');
    } catch {
      return { kind: 'unsupported', message: '正文编码无法识别，请先转换为 UTF-8。' };
    }
    if (text.includes('\0'))
      return { kind: 'unsupported', message: '检测到二进制内容，未作为文本读取。' };
    return {
      kind: 'text',
      text: text.slice(0, 24000),
      truncated: entry.size > bytesRead || text.length > 24000,
    };
  } finally {
    await file.close();
  }
}
