import fs from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
const project = process.cwd();
const parent = path.join(project, '08_演示体验');
const target = path.join(parent, '待整理示例');
await fs.mkdir(parent, { recursive: true });
const compiled = path.join(project, '06_构建产物/demo-generator.cjs');
await build({
  entryPoints: ['01_源码/electron/demo-samples.ts'],
  outfile: compiled,
  bundle: true,
  platform: 'node',
  format: 'cjs',
});
const { createSampleFolder } = await import(pathToFileURL(compiled).href);
const manifest = await createSampleFolder(target);
await fs.writeFile(
  path.join(parent, '样例清单.json'),
  JSON.stringify({ root: '待整理示例', ...manifest }, null, 2),
  { encoding: 'utf8', flag: 'wx' },
);
console.log(`Created ${manifest.fileCount} original, valid sample files: ${target}`);
