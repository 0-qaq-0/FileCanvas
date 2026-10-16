import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { build } from 'esbuild';
import electron from 'electron';
await build({
  entryPoints: ['01_源码/electron/main.ts', '01_源码/electron/preload.ts'],
  outdir: '06_构建产物/electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  external: ['electron'],
  format: 'cjs',
});
const server = await createServer();
await server.listen();
const childEnv = { ...process.env, FILECANVAS_DEV_URL: 'http://127.0.0.1:5173' };
delete childEnv.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: childEnv, windowsHide: true });
child.on('exit', async () => {
  await server.close();
  process.exit();
});
