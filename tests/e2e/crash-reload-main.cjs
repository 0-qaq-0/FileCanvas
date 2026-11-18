// Run by Electron itself, without Playwright: its debugger leaves the page that replaces a crashed
// one paused, so a crash can only be checked honestly from inside the main process. This starts the
// real app, crashes the page, answers the offered reload and reports what the page shows afterwards.
const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const report = { asked: 0, before: '', after: '', crashed: false };
const finish = (error) => {
  if (error) report.error = String(error);
  fs.writeFileSync(process.env.FILECANVAS_CRASH_REPORT, JSON.stringify(report));
  app.exit(0);
};
setTimeout(() => finish('timed out'), 60000);
dialog.showMessageBox = async (_window, options) => {
  report.asked++;
  report.message = options.message;
  return { response: 0 };
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const statusbar = (contents) =>
  contents.executeJavaScript("document.querySelector('.statusbar')?.textContent ?? ''");
const loaded = (contents) =>
  new Promise((resolve) => contents.once('did-finish-load', () => resolve()));

require(path.resolve('dist/electron/main.cjs'));
app.whenReady().then(async () => {
  try {
    let window;
    while (!(window = BrowserWindow.getAllWindows()[0])) await sleep(50);
    const contents = window.webContents;
    if (contents.isLoading()) await loaded(contents);
    await contents.executeJavaScript('window.fileCanvas.openDemo(6)');
    const reloaded = loaded(contents);
    contents.reload();
    await reloaded;
    while (!(report.before = await statusbar(contents)).includes('20 个文件')) await sleep(100);
    const back = loaded(contents);
    contents.once('render-process-gone', () => (report.crashed = true));
    contents.forcefullyCrashRenderer();
    await back;
    for (let i = 0; i < 100; i++) {
      report.after = await statusbar(contents);
      if (report.after === report.before) break;
      await sleep(100);
    }
    finish();
  } catch (error) {
    finish(error);
  }
});
