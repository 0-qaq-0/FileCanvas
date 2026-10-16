import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AiService, parseReply, validateEndpoint } from '../../01_源码/electron/ai';
import { readContent } from '../../01_源码/electron/content';
import { createProject, importPaths } from '../../01_源码/electron/filesystem';
import { importEntries, undo, workspace } from '../../01_源码/src/domain/workspace';
import { adoptAiPlan } from '../../01_源码/src/domain/ai-plan';
let base: string, root: string, settings: string, ai: AiService;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-ai-unit-'));
  root = path.join(base, '文档');
  settings = path.join(base, '设置');
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, '拍摄.md'),
    '# 拍摄方案\n客户需要三张校园照片，交付星期五。',
    'utf8',
  );
  await fs.writeFile(path.join(root, '预算.csv'), '项目,预算\n拍摄,300', 'utf8');
  await fs.writeFile(path.join(root, '.env'), 'API_KEY=do-not-send', 'utf8');
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules', 'secret.txt'), 'dependency-do-not-send');
  ai = new AiService(settings, {
    encrypt: (v) => Buffer.from(v).toString('base64'),
    decrypt: (v) => Buffer.from(v, 'base64').toString('utf8'),
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await fs.rm(base, { recursive: true, force: true });
});
async function project() {
  return importEntries(
    workspace(createProject(root)),
    await importPaths(root, [path.join(root, '拍摄.md'), path.join(root, '预算.csv')]),
    null,
  ).project;
}
it('previews UTF-8 and bounded content; rejects out-of-root, hidden credentials and unsupported binary formats', async () => {
  expect((await readContent(root, path.join(root, '拍摄.md'))).text).toContain('校园照片');
  expect((await readContent(root, path.join(root, '.env'))).kind).toBe('unsupported');
  await fs.writeFile(path.join(root, '合同.pdf'), 'not a real pdf');
  expect((await readContent(root, path.join(root, '合同.pdf'))).message).toContain('暂未提取');
  await fs.writeFile(path.join(root, '长文.txt'), '文字'.repeat(150000), 'utf8');
  const long = await readContent(root, path.join(root, '长文.txt'));
  expect(long.truncated).toBe(true);
  expect(long.text?.length).toBeLessThanOrEqual(24000);
  await fs.writeFile(path.join(base, '外部.txt'), 'outside');
  await expect(readContent(root, path.join(base, '外部.txt'))).rejects.toThrow('超出');
});
it('builds a local index, retrieves unimported relevant documents and never sends network requests during preparation', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await fs.writeFile(path.join(root, '未导入.txt'), '验收标准：照片应包含操场和图书馆。');
  const result = await ai.build(root);
  expect(result.files).toBe(3);
  expect(result.skipped).toBe(2);
  const p = await project();
  const context = await ai.prepare(root, p, [], '验收标准是什么');
  expect(context.sources.some((s) => s.path === '未导入.txt')).toBe(true);
  expect(JSON.stringify(context)).not.toContain('do-not-send');
  expect(fetcher).not.toHaveBeenCalled();
  ai.reset(path.join(base, 'another-root'));
  await expect(ai.ask(root, p, [], '验收标准是什么', false, context, [])).rejects.toThrow('变化');
});
it('protects configuration secrets and clears a previous provider key when the endpoint changes', async () => {
  await ai.save({ baseUrl: 'https://example.com/v1', model: 'test', apiKey: 'sensitive-key' });
  expect(await ai.settings()).toEqual({
    baseUrl: 'https://example.com/v1',
    model: 'test',
    hasKey: true,
  });
  expect(await fs.readFile(path.join(settings, 'ai-settings.json'), 'utf8')).not.toContain(
    'sensitive-key',
  );
  await ai.save({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'local' });
  expect((await ai.settings()).hasKey).toBe(false);
  expect(() => validateEndpoint('http://example.com')).toThrow('HTTPS');
  expect(() => validateEndpoint('https://user:key@example.com')).toThrow('密钥');
});
it('retrieves a relevant late file instead of filling context with the first eight files', async () => {
  const paths: string[] = [];
  for (let i = 0; i < 12; i++) {
    const fullPath = path.join(root, `资料${i}.txt`);
    await fs.writeFile(
      fullPath,
      i === 11 ? '验收标准：交付照片，图书馆与操场各一张。' : '无关草稿内容。',
      'utf8',
    );
    paths.push(fullPath);
  }
  const p = importEntries(
    workspace(createProject(root)),
    await importPaths(root, paths),
    null,
  ).project;
  const context = await ai.prepare(root, p, Object.keys(p.nodes), '验收标准');
  expect(context.sources).toHaveLength(8);
  expect(context.sources[0].path).toBe('资料11.txt');
  expect(context.omitted).toBe(4);
});
it('sends the reviewed context, validates model output and rejects stale questions', async () => {
  await ai.save({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'fixture' });
  const p = await project();
  const ids = Object.keys(p.nodes);
  const q = '按内容整理';
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: '建议按用途分类，依据拍摄.md',
                groups: [{ folder: '拍摄资料', ids: [ids[0]], reason: '拍摄方案正文' }],
              }),
            },
          },
        ],
      }),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  const context = await ai.prepare(root, p, ids, q);
  await expect(ai.ask(root, p, ids, 'changed question', true, context, [])).rejects.toThrow('变化');
  const reply = await ai.ask(
    root,
    p,
    ids,
    q,
    true,
    { ...context, sources: [{ path: 'forged', text: 'forged' }] },
    [],
  );
  expect(reply.groups).toHaveLength(1);
  const payload = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(JSON.stringify(payload)).toContain('校园照片');
  expect(JSON.stringify(payload)).not.toContain('forged');
  await expect(ai.ask(root, p, ids, q, true, context, [])).rejects.toThrow('变化');
});
it('rejects malicious plans, applies valid grouping atomically and undoes without changing source documents', async () => {
  const p = await project();
  const ids = Object.keys(p.nodes);
  const before = await fs.readFile(path.join(root, '拍摄.md'), 'utf8');
  expect(() =>
    parseReply(
      JSON.stringify({ answer: 'a', groups: [{ folder: '../escape', ids, reason: 'x' }] }),
      new Set(ids),
    ),
  ).toThrow();
  expect(() =>
    parseReply(
      JSON.stringify({ answer: 'a', groups: [{ folder: '资料', ids: ['outside'], reason: 'x' }] }),
      new Set(ids),
    ),
  ).toThrow('范围外');
  const next = adoptAiPlan(workspace(p), null, [{ folder: '拍摄资料', ids, reason: '用途' }], ids);
  expect(next.past).toHaveLength(1);
  expect(undo(next).project.nodes).toEqual(p.nodes);
  expect(await fs.readFile(path.join(root, '拍摄.md'), 'utf8')).toBe(before);
  expect(() =>
    adoptAiPlan(
      workspace(p),
      null,
      [
        { folder: '资料', ids: [ids[0]], reason: 'a' },
        { folder: '其它', ids: [ids[0]], reason: 'b' },
      ],
      ids,
    ),
  ).toThrow('变化');
});
it('requires project authorization, automatically retrieves context, caches file explanations and revokes access on model changes', async () => {
  await ai.save({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'local' });
  const p = await project(),
    id = Object.keys(p.nodes)[0];
  await expect(ai.explain(root, p, id)).rejects.toThrow('允许');
  await ai.fileAccess(root, true);
  await fs.writeFile(
    path.join(root, '项目说明.md'),
    '项目说明：拍摄方案与预算都属于校园拍摄资料。',
  );
  const reply = {
    purpose: '拍摄执行方案',
    contents: ['三张照片'],
    projectRole: '项目执行',
    action: 'move',
    destinationId: null,
    newFolder: '拍摄资料',
    reason: '依据项目说明',
  };
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }),
        ),
    );
  vi.stubGlobal('fetch', fetcher);
  const advice = await ai.explain(root, p, id);
  expect(advice.readBody).toBe(true);
  expect(advice.sources.some((s) => s.path === '项目说明.md')).toBe(true);
  await ai.explain(root, p, id);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await ai.explain(root, p, id, true);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(fetcher.mock.calls)).not.toContain('do-not-send');
  await ai.save({ baseUrl: 'http://127.0.0.1:11434/v1', model: 'another' });
  expect((await ai.fileAccess(root)).enabled).toBe(false);
});
