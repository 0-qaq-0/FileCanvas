import fs from 'node:fs/promises';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import path from 'node:path';
import type { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { MAX_NODES, uniqueGroupFiles } from '../src/domain/workspace';
import type { SourceEntry } from '../src/domain/types';
import { readEntry, readableError, systemOrPartial } from './filesystem';

async function groupEntry(root: string, file: string) {
  try {
    const entry = await readEntry(root, file);
    if (entry.kind !== 'file') throw new Error('请展开文件夹并选择里面的文件。');
    const blocked = systemOrPartial(entry.name);
    if (blocked) throw new Error(blocked);
    return entry;
  } catch (error) {
    throw new Error(`“${path.basename(file)}”：${readableError(error)}`);
  }
}

export async function resolveGroupFiles(root: string, paths: string[]): Promise<SourceEntry[]> {
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > MAX_NODES ||
    paths.some((file) => typeof file !== 'string')
  )
    throw new Error('请选择要加入分组的文件。');
  const entries: SourceEntry[] = [];
  for (const file of uniqueGroupFiles(paths)) entries.push(await groupEntry(root, file));
  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

function archiveNames(entries: SourceEntry[]) {
  const reserved = new Set(entries.map((entry) => entry.name.toLowerCase()));
  const used = new Set<string>();
  return entries.map((entry) => {
    let name = entry.name;
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    if (used.has(name.toLowerCase())) {
      let count = 2;
      do {
        const suffix = ` (${count++})${ext}`;
        name = stem.slice(0, Math.max(1, 255 - suffix.length)) + suffix;
      } while (reserved.has(name.toLowerCase()) || used.has(name.toLowerCase()));
    }
    used.add(name.toLowerCase());
    return name;
  });
}

export async function writeGroupZip(root: string, files: string[], destination: string) {
  const entries = await resolveGroupFiles(root, files);
  // Work next to the destination, then publish exclusively. A failed pack never
  // truncates an existing file or leaves a half-written archive from the encoder.
  const directory = await fs.realpath(path.dirname(destination));
  const target = path.join(directory, path.basename(destination));
  const conflict = '目标位置已经有同名文件，请换一个压缩包名称。';
  try {
    await fs.lstat(target);
    throw new Error(conflict);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const staging = await fs.mkdtemp(path.join(directory, '.filecanvas-zip-'));
  const temporary = path.join(staging, 'archive.zip');
  const zip = new ZipFile();
  const stream = zip.outputStream as PassThrough;
  let active: ReadStream | undefined;
  const fail = (error: Error) => stream.destroy(error);
  zip.on('error', fail);
  const output = pipeline(stream, createWriteStream(temporary, { flags: 'wx' }));
  try {
    const names = archiveNames(entries);
    entries.forEach((entry, index) => {
      zip.addReadStreamLazy(
        names[index],
        { mtime: new Date(entry.mtimeMs), size: entry.size },
        (open) => {
          void (async () => {
            const current = await groupEntry(root, entry.path);
            if (stream.destroyed) return;
            if (current.size !== entry.size || current.mtimeMs !== entry.mtimeMs)
              throw new Error(`“${entry.name}”在打包时发生了变化，请重试。`);
            active = createReadStream(current.path);
            active.once('error', (error) =>
              fail(new Error(`“${entry.name}”：${readableError(error)}`)),
            );
            open(null, active);
          })().catch(fail);
        },
      );
    });
    zip.end();
    await output;
    await fs.copyFile(temporary, target, constants.COPYFILE_EXCL);
    return target;
  } catch (error) {
    stream.destroy();
    await output.catch(() => {});
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(conflict);
    throw error;
  } finally {
    active?.destroy();
    await fs.unlink(temporary).catch(() => {});
    await fs.rmdir(staging).catch(() => {});
  }
}
