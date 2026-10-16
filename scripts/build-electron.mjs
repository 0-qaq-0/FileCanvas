import { build } from 'esbuild';
await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  external: ['electron'],
  format: 'cjs',
  sourcemap: true,
});
