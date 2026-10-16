import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createSampleFolder, sampleFiles } from '../../01_源码/electron/demo-samples';
import {
  createProject,
  generatePreview,
  importPaths,
  listDirectory,
} from '../../01_源码/electron/filesystem';
import { importEntries, workspace } from '../../01_源码/src/domain/workspace';
import { buildClassificationDraft } from '../../01_源码/src/domain/drafts';
let base = '';
afterEach(async () => {
  if (base && base.startsWith(path.join(os.tmpdir(), 'filecanvas-demo-unit-')))
    await fs.rm(base, { recursive: true, force: true });
  base = '';
});
describe('original demonstration dataset', () => {
  it('creates 20 valid samples, refuses overwriting, and preserves all bytes during classification and preview', async () => {
    base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-demo-unit-'));
    const root = path.join(base, '待整理示例');
    const manifest = await createSampleFolder(root);
    expect(manifest.fileCount).toBe(20);
    const samples = sampleFiles();
    expect(samples['封面草稿.png'].subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(samples['演示配音.wav'].toString('ascii', 0, 4)).toBe('RIFF');
    expect(samples['素材备份.zip'].readUInt32LE()).toBe(0x04034b50);
    await expect(createSampleFolder(root)).rejects.toHaveProperty('code', 'EEXIST');
    const state = importEntries(
      workspace(createProject(root)),
      await importPaths(
        root,
        (await listDirectory(root, root)).map((e) => e.path),
      ),
      null,
    );
    const draft = buildClassificationDraft(state, null, 'content-project');
    expect(draft.rows).toHaveLength(16);
    expect(draft.folders).toHaveLength(4);
    expect(draft.issues).toEqual([]);
    const preview = await generatePreview(root, draft.next!.project);
    expect(preview.changed).toBe(20);
    expect(preview.unchanged).toBe(6);
    expect(preview.issues).toBe(0);
    for (const file of manifest.files)
      expect(
        createHash('sha256')
          .update(await fs.readFile(path.join(root, file.path)))
          .digest('hex'),
      ).toBe(file.sha256);
  });
});
