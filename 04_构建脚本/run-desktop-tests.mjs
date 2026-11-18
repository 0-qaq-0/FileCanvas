import { spawnSync } from 'node:child_process';

// Runs every desktop suite one after another against the current build and reports them together,
// so one failure does not hide the others. Windows from different suites must not overlap.
const suites = [
  'simple-ui.e2e',
  'electron.e2e',
  'demo.e2e',
  'canvas-ai.e2e',
  'smart-organize.e2e',
  'tutorial.e2e',
  'settings.e2e',
  'views.e2e',
  'expanded-flow.e2e',
  'maturity.e2e',
  'recovery-crash',
];
const failed = [];
for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const { status } = spawnSync(process.execPath, [`02_测试/交互测试/${suite}.mjs`], {
    stdio: 'inherit',
    timeout: 7 * 60 * 1000,
  });
  if (status !== 0) failed.push(suite);
}
console.log(
  failed.length ? `\n未通过：${failed.join('、')}` : `\n全部 ${suites.length} 套桌面检查通过。`,
);
process.exit(failed.length ? 1 : 0);
