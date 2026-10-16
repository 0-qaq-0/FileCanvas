import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version))
  throw new Error('版本号不适合用作交付文件名。');
const createdAt = new Date().toISOString();
const runName = createdAt.replace(/[-:.]/g, '');
const delivery = path.join(root, '09_源码交付', runName);
const name = `FileCanvas-${pkg.version}-source`;
const source = path.join(delivery, name);
const archive = path.join(delivery, `${name}.zip`);
await fs.mkdir(path.dirname(delivery), { recursive: true });
await fs.mkdir(delivery);
await fs.mkdir(source);

const directories = ['01_源码', '02_测试', '04_构建脚本', '05_项目文档', '08_演示体验'];
const files = [
  'package.json',
  'package-lock.json',
  'README.md',
  'CHANGELOG.md',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  '.gitignore',
  '.gitattributes',
  '启动开发版.cmd',
];
for (const entry of [...directories, ...files]) {
  await fs.cp(path.join(root, entry), path.join(source, entry), {
    recursive: true,
    filter: async (filename) => {
      if ((await fs.lstat(filename)).isSymbolicLink())
        throw new Error(`源码包不包含链接：${filename}`);
      // 这个历史快捷方式依赖未随源码交付的 0.3.0 EXE。
      return path.basename(filename) !== '打开演示软件.cmd';
    },
  });
}
const checksums = [];
async function collect(directory) {
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else {
      const data = await fs.readFile(filename);
      checksums.push({
        path: path.relative(source, filename).split(path.sep).join('/'),
        bytes: data.length,
        sha256: createHash('sha256').update(data).digest('hex'),
      });
    }
  }
}
await collect(source);
let commit = null;
let workingTree = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  workingTree = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
    ? 'modified'
    : 'clean';
} catch {
  // 解压后的源码目录可能没有 Git；仍然可以再次打包。
}
await fs.writeFile(
  path.join(source, 'SOURCE_MANIFEST.json'),
  JSON.stringify(
    {
      name: pkg.name,
      version: pkg.version,
      createdAt,
      gitCommit: commit,
      workingTree,
      files: checksums,
    },
    null,
    2,
  ),
  'utf8',
);

const result = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `
  $ErrorActionPreference = 'Stop'
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $env:FILECANVAS_SOURCE_DIR, $env:FILECANVAS_SOURCE_ZIP,
    [System.IO.Compression.CompressionLevel]::Optimal, $true)
`,
  ],
  {
    env: { ...process.env, FILECANVAS_SOURCE_DIR: source, FILECANVAS_SOURCE_ZIP: archive },
    encoding: 'utf8',
    windowsHide: true,
  },
);
if (result.error || result.status !== 0)
  throw new Error(result.error?.message || result.stderr || '源码压缩失败。');
const sha256 = createHash('sha256')
  .update(await fs.readFile(archive))
  .digest('hex');
await fs.writeFile(path.join(delivery, 'SHA256SUMS.txt'), `${sha256}  ${name}.zip\n`, 'utf8');
console.log(
  JSON.stringify(
    { version: pkg.version, source, archive, files: checksums.length, sha256 },
    null,
    2,
  ),
);
