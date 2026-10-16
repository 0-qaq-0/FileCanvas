import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const results = [];
for (const ready of [false, true]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-close-'));
  const env = { ...process.env, FILECANVAS_E2E: '1', FILECANVAS_TEST_DATA: dir };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env });
  try {
    const page = await app.firstWindow();
    if (ready)
      await expect(page.getByRole('button', { name: '选择文件夹，开始整理' })).toBeVisible();
    const closed = app.waitForEvent('close', { timeout: 10000 });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await closed;
    results.push({ close: ready ? '界面就绪后' : '窗口出现后立即', status: 'passed' });
  } finally {
    await app.close();
  }
}
await fs.writeFile('test-results/close-smoke.json', JSON.stringify(results, null, 2), 'utf8');
console.log('Native close handshake passed in both startup states.');
