import { build } from 'esbuild';
await build({
  entryPoints: ['01_源码/electron/main.ts', '01_源码/electron/preload.ts'],
  outdir: '06_构建产物/electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  format: 'cjs',
  sourcemap: true,
});
