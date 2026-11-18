import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  createProject,
  fileId,
  importPaths,
  importSummary,
  listDirectory,
  readableError,
} from '../../app/electron/filesystem';
import { DiskOperations } from '../../app/electron/disk-operations';
import { ProjectStorage } from '../../app/electron/storage';
import { prepareRefresh } from '../../app/electron/refresh';
import { reopenSaved } from '../../app/electron/reopen';
import { readContent, excluded } from '../../app/electron/content';
import { parseReply, modelJson, validateEndpoint, AiService } from '../../app/electron/ai';
import { retryTransient, writeAtomic } from '../../app/electron/operation-plan';
import { Log } from '../../app/electron/log';
import { fitWindow } from '../../app/electron/window-state';
import {
  addFolder,
  hasPendingPlan,
  importEntries,
  moveNodes,
  pendingNodes,
  renameNode,
  workspace,
  MAX_NODES,
} from '../../app/src/domain/workspace';
import type { Project } from '../../app/src/domain/types';

let base: string, root: string;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-maturity-'));
  await fs.mkdir(path.join(base, '资料'));
  root = await fs.realpath(path.join(base, '资料'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(base, { recursive: true, force: true });
});
const write = async (relative: string, content = relative) => {
  const full = path.join(root, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
  return full;
};
async function projectOf(paths: string[]): Promise<Project> {
  return importEntries(workspace(createProject(root)), await importPaths(root, paths), null)
    .project;
}

describe('one definition of an unapplied plan', () => {
  it('counts a case-only rename, like the preview does', async () => {
    const file = await write('report.txt');
    const project = await projectOf([file]);
    expect(hasPendingPlan(project)).toBe(false);
    const renamed = renameNode(workspace(project), fileId(file), 'REPORT.txt').project;
    expect(hasPendingPlan(renamed)).toBe(true);
    expect(pendingNodes(renamed).map((n) => n.name)).toEqual(['REPORT.txt']);
  });
  it('brings a case-only rename back as an unapplied plan instead of refreshing over it', async () => {
    const file = await write('report.txt');
    const storage = new ProjectStorage(path.join(base, 'projects'));
    const project = renameNode(
      workspace(await projectOf([file])),
      fileId(file),
      'REPORT.txt',
    ).project;
    await storage.save(project);
    await write('新文件.txt');
    expect(await reopenSaved(storage, root, async (p) => p)).toEqual(project);
  });
});

describe('opening a folder that cannot be refreshed', () => {
  it('still opens the saved project', async () => {
    const file = await write('a.txt');
    const storage = new ProjectStorage(path.join(base, 'projects'));
    const project = await projectOf([file]);
    await storage.save(project);
    await fs.rm(root, { recursive: true, force: true });
    expect((await reopenSaved(storage, root, async (p) => p))?.id).toBe(project.id);
  });
});

describe('importing real folders', () => {
  it('leaves out a nested link or unreadable item, and keeps the rest', async () => {
    await write('项目/说明.txt');
    await fs.mkdir(path.join(base, '外面'));
    await fs.symlink(path.join(base, '外面'), path.join(root, '项目', '联接'), 'junction');
    const summary = await importSummary(root, [path.join(root, '项目')]);
    expect(summary.entries.map((e) => e.entry.name)).toEqual(['项目', '说明.txt']);
    expect(summary.skipped).toBe(1);
    expect(summary.limited).toBe(false);
  });
  it('does not read node_modules or .git file by file', async () => {
    await write('应用/node_modules/包/index.js');
    await write('应用/.git/config');
    await write('应用/入口.js');
    const { entries } = await importSummary(root, [path.join(root, '应用')]);
    expect(entries.map((e) => e.entry.name).sort()).toEqual(
      ['.git', 'node_modules', '入口.js', '应用'].sort(),
    );
  });
  it('fills the room breadth first, so everything near the top makes it', async () => {
    await write('甲/深/1.txt');
    await write('甲/深/2.txt');
    await write('甲/3.txt');
    await write('乙.txt');
    const paths = [path.join(root, '甲'), path.join(root, '乙.txt')];
    const summary = await importSummary(root, paths, { room: 4 });
    expect(summary.limited).toBe(true);
    expect(summary.entries.map((e) => e.entry.name).sort()).toEqual(
      ['3.txt', '乙.txt', '深', '甲'].sort(),
    );
    await expect(importPaths(root, paths)).resolves.toHaveLength(6);
  });
  it('does not count what is already on the canvas against the room', async () => {
    const a = await write('a.txt');
    const b = await write('b.txt');
    const summary = await importSummary(root, [a, b], { room: 1, known: new Set([fileId(a)]) });
    expect(summary.entries).toHaveLength(2);
    expect(summary.limited).toBe(false);
  });
  it('keeps the most recent entries of a huge folder and says how many are left out', async () => {
    const names = Array.from({ length: MAX_NODES + 3 }, (_, i) => `f${i}.txt`);
    for (let i = 0; i < names.length; i += 500)
      await Promise.all(names.slice(i, i + 500).map((n) => fs.writeFile(path.join(root, n), '')));
    const old = new Date(Date.now() - 86_400_000);
    await fs.utimes(path.join(root, 'f7.txt'), old, old);
    await expect(listDirectory(root, root)).rejects.toThrow('超过 5000');
    const listing = await listDirectory(root, root, { cap: true });
    expect(listing.filter((e) => !e.blocked)).toHaveLength(MAX_NODES);
    expect(listing.find((e) => e.overflow)?.overflow).toBe(3);
    expect(listing.some((e) => e.name === 'f7.txt')).toBe(false);
  }, 60_000);
  it('never shows its own working files', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    await fs.mkdir(path.join(root, `.filecanvas-operation-${id}`));
    await write(`.filecanvas-operation-${id}/0`);
    await write(`.filecanvas-probe-${id}-a`);
    await write('真实.txt');
    expect((await listDirectory(root, root)).map((e) => e.name)).toEqual(['真实.txt']);
  });
});

describe('refreshing', () => {
  it('does not bring back what the user took off the canvas', async () => {
    const keep = await write('留下.txt');
    const gone = await write('移出.txt');
    await write('移出的文件夹/里面.txt');
    const project = await projectOf([keep]);
    project.view = {
      removedIds: [fileId(gone), fileId(path.join(root, '移出的文件夹'))],
    };
    await write('新的.txt');
    const review = await prepareRefresh(root, project);
    expect(review.changes.map((c) => c.name)).toEqual(['新的.txt']);
    expect(Object.values(review.project.nodes).map((n) => n.name)).toEqual([
      '留下.txt',
      '新的.txt',
    ]);
  });
  it('reports a file added to a folder once, not the folder as changed too', async () => {
    await write('文件夹/旧.txt');
    const project = await projectOf([path.join(root, '文件夹')]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await write('文件夹/新.txt');
    const review = await prepareRefresh(root, project);
    expect(review.changes.map((c) => `${c.kind}:${c.name}`)).toEqual(['new:新.txt']);
  });
});

describe('applying more than a handful of files', () => {
  it('moves and restores a folder of 300 files as one operation', async () => {
    for (let i = 0; i < 300; i += 50)
      await Promise.all(
        Array.from({ length: 50 }, (_, k) => write(`大文件夹/${i + k}.txt`, `内容${i + k}`)),
      );
    const disk = new DiskOperations(path.join(base, '记录'));
    const phases = new Set<string>();
    const tracked = new DiskOperations(path.join(base, '记录'), (p) => phases.add(p.phase));
    const start = addFolder(
      workspace(await projectOf([path.join(root, '大文件夹')])),
      '归档',
      null,
    );
    const target = Object.values(start.project.nodes).find((n) => n.name === '归档')!;
    const planned = moveNodes(start, [fileId(path.join(root, '大文件夹'))], target.id).project;
    const preview = await tracked.preview(root, planned);
    expect(preview.issues).toBe(0);
    expect(phases).toContain('读取并校验文件');
    await tracked.apply(root, planned, preview.planId);
    expect(phases).toContain('建立恢复点');
    expect(await fs.readdir(path.join(root, '归档', '大文件夹'))).toHaveLength(300);
    await disk.undo(root, planned.id);
    expect(await fs.readFile(path.join(root, '大文件夹', '299.txt'), 'utf8')).toBe('内容299');
    expect(existsSync(path.join(root, '归档'))).toBe(false);
  }, 60_000);
  it('names the entry that keeps a folder from moving', async () => {
    await write('项目/node_modules/包/a.js');
    await write('项目/说明.txt');
    const disk = new DiskOperations(path.join(base, '记录'));
    const start = addFolder(workspace(await projectOf([path.join(root, '项目')])), '归档', null);
    const target = Object.values(start.project.nodes).find((n) => n.name === '归档')!;
    const planned = moveNodes(start, [fileId(path.join(root, '项目'))], target.id).project;
    const issues = (await disk.preview(root, planned)).changes.flatMap((c) => c.issues).join();
    expect(issues).toContain(path.join('node_modules', '包'));
  });
});

describe('records that are damaged or full', () => {
  it('one unreadable record does not stop other folders', async () => {
    const dir = path.join(base, '记录');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'broken-record.json'), '{ not json');
    const file = await write('a.txt');
    const disk = new DiskOperations(dir);
    const project = addFolder(workspace(await projectOf([file])), '新', null).project;
    expect((await disk.preview(root, project)).planId).toBeTruthy();
  });
  it('sets aside the project’s own damaged record and opens the project', async () => {
    const dir = path.join(base, '记录');
    await fs.mkdir(dir);
    const file = await write('a.txt');
    const project = await projectOf([file]);
    await fs.writeFile(path.join(dir, `${project.id}.json`), '{ not json');
    const disk = new DiskOperations(dir);
    expect(await disk.reconcile(project)).toBe(project);
    expect(await disk.status(root, project.id)).toBeNull();
    expect((await fs.readdir(dir)).some((n) => n.includes('.damaged-'))).toBe(true);
  });
  it('keeps only the latest operation records', async () => {
    const dir = path.join(base, '记录');
    const history = path.join(dir, 'history');
    await fs.mkdir(history, { recursive: true });
    for (let i = 0; i < 25; i++) await fs.writeFile(path.join(history, `${i}.json`), '{}');
    const file = await write('a.txt');
    const disk = new DiskOperations(dir);
    const start = addFolder(workspace(await projectOf([file])), '新', null);
    const folder = Object.values(start.project.nodes).find((n) => n.name === '新')!;
    const first = moveNodes(start, [fileId(file)], folder.id).project;
    await disk.apply(root, first);
    await disk.undo(root, first.id);
    await disk.apply(root, first);
    expect((await fs.readdir(history)).length).toBeLessThanOrEqual(20);
  });
});

describe('errors in the user’s words', () => {
  const failure = (code: string, file = 'D:\\资料\\报告.pdf') =>
    Object.assign(new Error(`${code}: raw system message`), { code, path: file });
  it.each([
    ['EBUSY', '被其他程序占用'],
    ['EPERM', '没有访问权限'],
    ['ENOSPC', '磁盘空间不足'],
    ['EEXIST', '不会覆盖'],
  ])('%s', (code, words) => {
    const message = readableError(failure(code));
    expect(message).toContain(words);
    expect(message).not.toContain('raw system message');
  });
  it('names the file', () => {
    expect(readableError(failure('EBUSY'))).toContain('报告.pdf');
  });
  it('keeps a message that has no system code', () => {
    expect(readableError(new Error('已说明的原因'))).toBe('已说明的原因');
  });
});

describe('writing on Windows', () => {
  it('waits out a file briefly held by antivirus or indexing', async () => {
    let attempts = 0;
    const result = await retryTransient(async () => {
      if (++attempts < 3) throw Object.assign(new Error('held'), { code: 'EPERM' });
      return 'done';
    });
    expect(result).toBe('done');
    expect(attempts).toBe(3);
  });
  it('fails right away on anything else, and gives up on a real lock', async () => {
    let attempts = 0;
    await expect(
      retryTransient(async () => {
        attempts++;
        throw Object.assign(new Error('gone'), { code: 'ENOENT' });
      }),
    ).rejects.toThrow('gone');
    expect(attempts).toBe(1);
    await expect(
      retryTransient(async () => {
        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      }),
    ).rejects.toThrow('locked');
  });
  it('leaves no temporary file behind', async () => {
    const file = path.join(base, 'a.json');
    await writeAtomic(file, { ok: true });
    await writeAtomic(file, { ok: 2 });
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({ ok: 2 });
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});

describe('reading text', () => {
  it('reads GBK, the usual encoding of text from Chinese Windows', async () => {
    // “中文报告” in GBK.
    await fs.writeFile(
      path.join(root, '旧.txt'),
      Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xa8, 0xb8, 0xe6]),
    );
    expect((await readContent(root, path.join(root, '旧.txt'))).text).toBe('中文报告');
  });
  it('reads UTF-16 in both byte orders', async () => {
    await fs.writeFile(path.join(root, 'le.txt'), Buffer.from([0xff, 0xfe, 0x2d, 0x4e]));
    await fs.writeFile(path.join(root, 'be.txt'), Buffer.from([0xfe, 0xff, 0x4e, 0x2d]));
    expect((await readContent(root, path.join(root, 'le.txt'))).text).toBe('中');
    expect((await readContent(root, path.join(root, 'be.txt'))).text).toBe('中');
  });
  it('still prefers UTF-8', async () => {
    await fs.writeFile(path.join(root, '新.txt'), '中文报告', 'utf8');
    expect((await readContent(root, path.join(root, '新.txt'))).text).toBe('中文报告');
  });
  it.each(['密码.txt', '账号密码表.csv', 'my_password.txt', 'api-key.txt', 'secrets.json', '.env'])(
    'keeps %s away from previews and AI',
    (name) => expect(excluded(name)).toBe(true),
  );
  it.each(['tokenizer.py', '密切相关.txt', '报告.txt', 'passwordless-notes.md'])(
    'still reads %s',
    (name) => expect(excluded(name)).toBe(false),
  );
});

describe('AI answers and settings', () => {
  it('finds JSON wrapped in a fence, reasoning or a sentence', () => {
    const value = { answer: 'a', groups: [] };
    const json = JSON.stringify(value);
    expect(modelJson(`\`\`\`json\n${json}\n\`\`\``)).toEqual(value);
    expect(modelJson(`<think>想一想 {不是答案}</think>\n${json}`)).toEqual(value);
    expect(modelJson(`这是方案：${json} 请核对。`)).toEqual(value);
    expect(modelJson('没有 JSON')).toBeNull();
  });
  it('gives a readable error when a model does not return a plan', () => {
    expect(() => parseReply('抱歉，我无法完成。', new Set())).toThrow('有效的整理方案');
  });
  it('explains a malformed address', () => {
    expect(() => validateEndpoint('api.deepseek.com')).toThrow('格式不正确');
  });
  it('says so when a saved key cannot be decrypted, instead of blaming the network', async () => {
    const ai = new AiService(base, {
      encrypt: (v) => v,
      decrypt: () => {
        throw new Error('bad');
      },
    });
    await ai.save({ baseUrl: 'https://example.com/v1', model: 'm', apiKey: 'k' });
    await expect(ai.test()).rejects.toThrow('无法解密');
  });
});

describe('saved projects', () => {
  it('forgets a project without touching its folder', async () => {
    const file = await write('a.txt');
    const storage = new ProjectStorage(path.join(base, 'projects'));
    const project = await projectOf([file]);
    await storage.save(project);
    await storage.remove(project.id);
    expect(await storage.list()).toHaveLength(0);
    expect(await storage.last()).toBeNull();
    expect(existsSync(file)).toBe(true);
    await expect(storage.remove('../escape')).rejects.toThrow('ID');
  });
  it('marks sample copies in the list', async () => {
    const storage = new ProjectStorage(path.join(base, 'projects'));
    await storage.save({
      ...createProject(root),
      demo: { scenario: 'content-project', fixtureVersion: 1 },
    });
    expect((await storage.list())[0].demo).toBe(true);
  });
});

describe('window placement', () => {
  const screen = { x: 0, y: 0, width: 1920, height: 1040 };
  it('comes back where it was', () => {
    expect(
      fitWindow({ x: 100, y: 50, width: 1200, height: 800, maximized: true }, [screen]),
    ).toEqual({ x: 100, y: 50, width: 1200, height: 800, maximized: true });
  });
  it('fits a small screen the first time', () => {
    expect(fitWindow(null, [{ x: 0, y: 0, width: 1280, height: 680 }])).toEqual({
      width: 1280,
      height: 680,
      maximized: false,
    });
  });
  it('leaves placement to the system when the saved monitor is gone', () => {
    const state = fitWindow({ x: 3000, y: 100, width: 1200, height: 800 }, [screen]);
    expect(state.x).toBeUndefined();
    expect(state.width).toBe(1200);
  });
  it('keeps the title bar reachable', () => {
    expect(fitWindow({ x: 100, y: -300, width: 1200, height: 800 }, [screen]).x).toBeUndefined();
  });
  it('ignores damaged values', () => {
    for (const saved of ['x', 7, { width: 'a', height: 2 }, { width: NaN, height: 800 }])
      expect(fitWindow(saved, [screen]).x).toBeUndefined();
    expect(fitWindow({ width: 10, height: 10 }, [screen]).width).toBe(1000);
  });
  it('accepts a monitor to the left of the main one', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(fitWindow({ x: -1500, y: 100, width: 1200, height: 800 }, [screen, left]).x).toBe(-1500);
  });
});

describe('diagnostics log', () => {
  it('writes, rotates at its size limit and never throws', () => {
    const log = new Log(path.join(base, 'logs'));
    log.write('error', '出错了', new Error('原因'));
    expect(readFileSync(log.file, 'utf8')).toContain('出错了');
    expect(readFileSync(log.file, 'utf8')).toContain('原因');
    log.write('info', 'x'.repeat(1024 * 1024 + 10));
    log.write('info', '之后');
    expect(existsSync(`${log.file}.1`)).toBe(true);
    expect(readFileSync(log.file, 'utf8')).toContain('之后');
    expect(() => new Log(path.join(log.file, 'cannot')).write('info', 'x')).not.toThrow();
  });
});
