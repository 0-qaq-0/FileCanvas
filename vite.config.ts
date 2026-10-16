import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: '01_源码',
  base: './',
  build: { outDir: '../06_构建产物/renderer', emptyOutDir: true },
  plugins: [
    react(),
    {
      name: 'dev-only-react-preamble',
      apply: 'serve',
      transformIndexHtml: (html) =>
        html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
    },
  ],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
