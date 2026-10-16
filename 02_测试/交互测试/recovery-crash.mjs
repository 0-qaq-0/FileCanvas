import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const filename = fileURLToPath(import.meta.url),
  projectRoot = path.resolve(path.dirname(filename), '../..');
const output = path.join(projectRoot, '03_测试结果', '产品化恢复');
const childMode = process.argv[2] === '--child';
if (!childMode) {
  await fs.mkdir(output, { recursive: true });
  await build({
    stdin: {
      contents: `
    export { DiskOperations } from './01_源码/electron/disk-operations';
    export { createProject, importPaths } from './01_源码/electron/filesystem';
    export { workspace, importEntries, moveNodes, renameNode } from './01_源码/src/domain/workspace';
    export { inventory, inventoryDigest, hashFile } from './01_源码/electron/operation-plan';
  `,
      resolveDir: projectRoot,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(output, 'engine.cjs'),
  });
}
const {
  DiskOperations,
  createProject,
  importPaths,
  workspace,
  importEntries,
  moveNodes,
  renameNode,
  inventory,
  inventoryDigest,
  hashFile,
} = createRequire(import.meta.url)(path.join(output, 'engine.cjs'));
if (childMode) {
  const config = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
  const limit = Number(process.argv[4]),
    edge = process.argv[5];
  let count = 0;
  for (const method of ['link', 'unlink', 'mkdir', 'rmdir', 'rename']) {
    const original = fs[method].bind(fs);
    fs[method] = async (...args) => {
      const own = typeof args[0] === 'string' && args[0].startsWith(config.base + path.sep);
      const current = own ? ++count : 0;
      if (current === limit && edge === 'before') process.exit(92);
      const result = await original(...args);
      if (current === limit && edge === 'after') process.exit(92);
      return result;
    };
  }
  const disk = new DiskOperations(config.journals);
  if (config.phase === 'apply') await disk.apply(config.root, config.planned);
  else await disk.undo(config.root, config.planned.id);
  console.log(JSON.stringify({ count }));
} else {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-crash-matrix-'));
  async function fixture(phase, label) {
    const own = path.join(base, label),
      root = path.join(own, '真实项目'),
      journals = path.join(own, '记录');
    await fs.mkdir(path.join(root, 'Source', 'Child'), { recursive: true });
    await fs.mkdir(path.join(root, '交付'));
    await fs.writeFile(
      path.join(root, 'Source', 'Child', 'Example.txt'),
      '中文与 UTF-8 文件内容\n一二三',
    );
    await fs.writeFile(path.join(root, 'Source', '第二个.txt'), '另外一份真实内容');
    await fs.writeFile(path.join(root, '不参与.txt'), '保持不变');
    const initial = importEntries(
      workspace(createProject(root)),
      await importPaths(root, [path.join(root, 'Source'), path.join(root, '交付')]),
      null,
    );
    const get = (name) => Object.values(initial.project.nodes).find((n) => n.name === name);
    let next = moveNodes(initial, [get('Source').id], get('交付').id);
    next = renameNode(next, get('Example.txt').id, 'example.txt');
    const planned = next.project,
      baseline = inventoryDigest(await inventory(root));
    const hashes = [
      await hashFile(path.join(root, 'Source', 'Child', 'Example.txt')),
      await hashFile(path.join(root, 'Source', '第二个.txt')),
    ];
    if (phase === 'undo') await new DiskOperations(journals).apply(root, planned);
    const configPath = path.join(own, 'config.json');
    await fs.writeFile(
      configPath,
      JSON.stringify({ base: own, root, journals, planned, phase }),
      'utf8',
    );
    return { root, journals, planned, baseline, hashes, configPath };
  }
  const checks = [];
  for (const phase of ['apply', 'undo']) {
    const probe = await fixture(phase, `${phase}-probe`);
    const first = spawnSync(
      process.execPath,
      [filename, '--child', probe.configPath, '0', 'after'],
      { encoding: 'utf8', windowsHide: true },
    );
    assert.equal(first.status, 0, first.stderr);
    const { count } = JSON.parse(first.stdout.trim());
    for (const edge of ['before', 'after']) {
      for (let step = 1; step <= count; step++) {
        const f = await fixture(phase, `${phase}-${edge}-${step}`);
        const child = spawnSync(
          process.execPath,
          [filename, '--child', f.configPath, String(step), edge],
          { encoding: 'utf8', windowsHide: true },
        );
        assert.equal(child.status, 92, child.stderr);
        const reopened = new DiskOperations(f.journals);
        const status = await reopened.status(f.root, f.planned.id);
        if (status?.canUndo) await reopened.undo(f.root, f.planned.id);
        assert.equal(
          inventoryDigest(await inventory(f.root)),
          f.baseline,
          `${phase}/${edge}/${step}: directory mismatch`,
        );
        assert.equal(
          await hashFile(path.join(f.root, 'Source', 'Child', 'Example.txt')),
          f.hashes[0],
        );
        assert.equal(await hashFile(path.join(f.root, 'Source', '第二个.txt')), f.hashes[1]);
        checks.push({ phase, edge, step, recovered: true });
      }
      console.log(`PASS ${phase} ${edge}: ${count} mutation boundaries recovered`);
    }
  }
  await fs.writeFile(
    path.join(output, 'crash-results.json'),
    JSON.stringify(
      {
        status: 'passed',
        base,
        count: checks.length,
        checks,
        scope: 'Process exit before/after filesystem mutations; no hardware power-loss simulation',
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(
    `PASS ${checks.length} crash recovery cases; original paths, exact names and content hashes verified`,
  );
}
