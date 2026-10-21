import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-ai-'));
const data = path.join(base, '应用数据'),
  root = path.join(base, '项目');
await fs.mkdir(data);
await fs.mkdir(root);
await fs.writeFile(
  path.join(root, '拍摄方案.md'),
  '# 校园拍摄\n客户要三张照片。周五交付图书馆和操场成片。',
  'utf8',
);
await fs.mkdir(path.join(root, '参考'));
await fs.writeFile(
  path.join(root, '参考', '验收标准.txt'),
  '交付三张 JPG，每张不超过 2MB。',
  'utf8',
);
await fs.writeFile(path.join(root, '合同.pdf'), 'unsupported-fixture');
await fs.writeFile(path.join(root, '.env'), 'SECRET_DO_NOT_SEND=test');
const calls = [];
const assertions = [];
const errors = [];
const server = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  calls.push(request);
  const prompt = request.messages.at(-1).content;
  let answer = '连接成功';
  if (prompt.startsWith('{')) {
    const input = JSON.parse(prompt);
    answer = input.task.includes('JSON')
      ? JSON.stringify({
          answer: '拍摄方案.md 包含校园拍摄任务，建议归入项目资料。',
          groups: [
            {
              folder: '项目资料',
              ids: input.manifest.filter((n) => n.kind === 'file').map((n) => n.id),
              reason: '按当前任务归档；未提取正文的文件仍需人工核对。',
            },
          ],
        })
      : '拍摄方案.md：客户要求三张校园照片，周五交付。参考/验收标准.txt：JPG，每张不超过 2MB。';
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const env = {
  ...process.env,
  FILECANVAS_E2E: '1',
  FILECANVAS_TEST_ROOT: root,
  FILECANVAS_TEST_DATA: data,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
const hash = async () =>
  createHash('sha256')
    .update(await fs.readFile(path.join(root, '拍摄方案.md')))
    .digest('hex');
const original = await hash();
function pass(s) {
  assertions.push(s);
  console.log(`PASS ${s}`);
}
try {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '选择文件夹，开始整理' }).click();
  const card = (name) => page.locator(`[data-testid="canvas-card"][data-name="${name}"]`);
  await expect(card('拍摄方案.md')).toBeVisible();
  await expect(page.locator('.browser-drawer')).toHaveCount(0);
  const rect = await page.locator('.canvas-scroll').boundingBox();
  expect(rect.width).toBeGreaterThan(1250);
  // The suggestion strip and the view tabs now sit above the canvas; 560px still leaves two rows.
  expect(rect.height).toBeGreaterThan(560);
  await card('拍摄方案.md').click();
  await expect(page.locator('.text-preview')).toContainText('图书馆和操场');
  await page.getByRole('button', { name: '收起内容预览' }).click();
  await card('参考').click();
  await page.getByRole('button', { name: '预览 参考', exact: true }).click();
  await expect(page.locator('.preview-children')).toContainText('验收标准.txt');
  await page
    .locator('.preview-children')
    .getByRole('button', { name: /验收标准/ })
    .click();
  await expect(page.locator('.text-preview')).toContainText('2MB');
  await page.getByRole('button', { name: '收起内容预览' }).click();
  await card('合同.pdf').click();
  await expect(page.locator('.unsupported-preview')).toContainText('暂未提取正文');
  await page.getByRole('button', { name: '收起内容预览' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '专注画布', exact: true }).click();
  await expect(page.locator('.main-header')).toBeHidden();
  await page.screenshot({ path: '03_测试结果/canvas-focus.png' });
  await page.getByRole('button', { name: '退出专注', exact: true }).click();
  pass('打开即显示画布；本地文本预览、文件夹内文件预览、未支持格式提示与专注模式通过');
  await page.getByRole('button', { name: '文件栏', exact: true }).click();
  await expect(page.getByTestId('source-row').first()).toBeVisible();
  await page.getByRole('button', { name: '收起文件栏' }).click();
  await page.screenshot({ path: '03_测试结果/canvas-home.png' });
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByLabel('常用 AI 服务').selectOption('DeepSeek');
  await expect(page.getByLabel('AI 模型名称')).toHaveValue('deepseek-flash');
  await page.getByLabel('常用 AI 服务').selectOption('Ollama · 本机');
  await expect(page.getByLabel('AI 服务地址')).toHaveValue('http://127.0.0.1:11434/v1');
  await page.getByLabel('常用 AI 服务').selectOption('自定义');
  await page.getByLabel('AI 服务地址').fill(endpoint);
  await page.getByLabel('AI 模型名称').fill('fixture-model');
  await page.getByLabel('AI API 密钥').fill('local-fixture-secret');
  await page.getByRole('button', { name: '保存并测试连接' }).click();
  await expect(page.getByText('连接成功：模型已返回有效文本。')).toBeVisible();
  expect(calls).toHaveLength(1);
  expect(await fs.readFile(path.join(data, 'ai-settings.json'), 'utf8')).not.toContain(
    'local-fixture-secret',
  );
  expect((await page.evaluate(() => window.fileCanvas.aiSettings())).data.hasKey).toBe(true);
  await page.getByRole('button', { name: '模型设置', exact: true }).click();
  await page.getByRole('button', { name: '建立 / 更新索引' }).click();
  await expect(page.locator('.index-card')).toContainText('已索引 2 份文本');
  await page.getByLabel('问 AI 或描述整理目标').fill('这次拍摄要求是什么？验收标准是什么？');
  await page.getByRole('button', { name: '问文件 / 查资料' }).click();
  await expect(page.locator('.context-preview')).toBeVisible();
  expect(calls).toHaveLength(1);
  await expect(page.getByRole('button', { name: '发送问题', exact: true })).toBeDisabled();
  await page.getByRole('checkbox', { name: '允许发送以上资料到已配置的模型服务' }).check();
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  await expect(page.locator('.ai-message.assistant').last()).toContainText('2MB');
  expect(JSON.stringify(calls)).not.toContain('SECRET_DO_NOT_SEND');
  expect(JSON.stringify(calls)).toContain('校园拍摄');
  pass(
    '常用服务与自定义配置、连接测试、本地索引、预览资料与确认发送、内容问答通过（本机模拟服务）',
  );
  await page.getByLabel('问 AI 或描述整理目标').fill('请按任务整理当前目录文件');
  await page.getByRole('button', { name: 'AI 整理', exact: true }).click();
  await page.getByRole('checkbox', { name: '允许发送以上资料到已配置的模型服务' }).check();
  await page.getByRole('button', { name: '发送并生成整理草案' }).click();
  await expect(page.locator('.ai-plan')).toContainText('项目资料');
  await page.screenshot({ path: '03_测试结果/canvas-ai-plan.png' });
  await page.getByRole('button', { name: '采用到画布（可撤销）' }).click();
  await expect(card('项目资料')).toBeVisible();
  await expect(card('拍摄方案.md')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(card('拍摄方案.md')).toBeVisible();
  await expect(card('项目资料')).toHaveCount(0);
  expect(await hash()).toBe(original);
  await page.getByRole('button', { name: '收起 AI 助手' }).click();
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await expect(page.locator('.index-card')).toContainText('已索引 2 份文本');
  await expect(page.locator('.ai-message.assistant').first()).toContainText('2MB');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '03_测试结果/canvas-ai-compact.png' });
  pass('AI 整理草案可查看、采用并一步撤销；原文件哈希不变；1000×680 无页面溢出');
  expect(errors).toEqual([]);
  await fs.writeFile(
    '03_测试结果/canvas-ai-acceptance.json',
    JSON.stringify(
      {
        status: 'passed',
        base,
        assertions,
        errors,
        modelTest: 'local deterministic OpenAI-compatible fixture; no live provider calls',
        requests: calls.length,
      },
      null,
      2,
    ),
    'utf8',
  );
} catch (error) {
  if (app)
    await (await app.firstWindow()).screenshot({ path: '03_测试结果/canvas-ai-failure.png' });
  await fs.writeFile(
    '03_测试结果/canvas-ai-acceptance.json',
    JSON.stringify({ status: 'failed', base, assertions, error: String(error), errors }, null, 2),
    'utf8',
  );
  throw error;
} finally {
  if (app) await app.close();
  await new Promise((resolve) => server.close(resolve));
}
