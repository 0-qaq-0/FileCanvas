import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash } from 'node:crypto';
await import('../../04_构建脚本/build-electron.mjs');
const vite = await createServer();
await vite.listen();
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'filecanvas-e2e-expanded-')),
  root = path.join(base, '校园拍摄项目'),
  data = path.join(base, '应用数据');
await fs.mkdir(data);
await fs.mkdir(root);
await fs.mkdir(path.join(root, '待整理'));
await fs.mkdir(path.join(root, '已分类'));
await fs.mkdir(path.join(root, '待整理', '子目录'));
await fs.writeFile(
  path.join(root, '待整理', '拍摄方案.md'),
  '# 校园拍摄执行方案\n需要三张校园照片，地点为图书馆和操场，周五交付。',
);
await fs.writeFile(path.join(root, '待整理', '预算.csv'), '项目,预算\n拍摄,300');
await fs.writeFile(
  path.join(root, '待整理', '子目录', '验收标准.txt'),
  '验收要求：三张 JPG，每张不超过 2MB。',
);
await fs.writeFile(path.join(root, '已分类', '交付清单.md'), '# 交付清单\n三张校园照片。');
await fs.writeFile(
  path.join(root, '项目说明.md'),
  '# 校园拍摄项目\n项目资料统一存放在已分类目录，周五交付三张照片。',
);
await fs.writeFile(
  path.join(root, '封面.png'),
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const original = await fs.readFile(path.join(root, '待整理', '拍摄方案.md'));
const digest = (value) => createHash('sha256').update(value).digest('hex');
const calls = [],
  assertions = [],
  errors = [];
const api = http.createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const request = JSON.parse(body);
  calls.push(request);
  const last = request.messages.at(-1).content;
  let answer = '连接成功';
  if (last.startsWith('{')) {
    const input = JSON.parse(last);
    if (input.task?.startsWith('解释选中文件'))
      answer = JSON.stringify({
        purpose: '这是一份校园拍摄的执行方案',
        contents: ['拍摄地点：图书馆和操场', '交付要求：三张照片，周五完成'],
        projectRole: '与项目说明和交付清单中的三张校园照片对应。',
        action: 'move',
        destinationId: input.folders.find((f) => f.name === '已分类').id,
        newFolder: null,
        reason: '项目说明.md 约定项目资料统一存放在已分类目录。',
      });
    else answer = '依据项目说明.md，项目资料应放在已分类目录；拍摄方案.md 给出了具体执行要求。';
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
});
await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${api.address().port}/v1`;
const env = {
  ...process.env,
  FILECANVAS_DEV_URL: 'http://127.0.0.1:5173',
  FILECANVAS_E2E: '1',
  FILECANVAS_TEST_ROOT: root,
  FILECANVAS_TEST_DATA: data,
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
await fs.mkdir('03_测试结果', { recursive: true });
function pass(s) {
  assertions.push(s);
  console.log(`PASS ${s}`);
}
try {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '选择文件夹，开始整理' }).click();
  await expect(page.locator('.statusbar')).toContainText('6 个文件');
  const card = (name) => page.locator(`[data-testid="canvas-card"][data-name="${name}"]`);
  await card('待整理').click();
  await expect(card('拍摄方案.md')).toBeVisible();
  await expect(card('待整理')).toHaveAttribute('data-expanded', 'true');
  await card('已分类').click();
  await expect(card('交付清单.md')).toBeVisible();
  await card('子目录').click();
  await expect(card('验收标准.txt')).toBeVisible();
  await expect(card('待整理')).toBeVisible();
  await expect(card('已分类')).toBeVisible();
  async function dragCard(name, dest, hoverOpen = false) {
    await card(name).scrollIntoViewIfNeeded();
    const from = await card(name).boundingBox();
    let target;
    if (dest) {
      await card(dest).scrollIntoViewIfNeeded();
      target = await card(dest).boundingBox();
    } else target = await page.getByTestId('canvas').boundingBox();
    await page.mouse.move(from.x + 60, from.y + 65);
    await page.mouse.down();
    await page.mouse.move(target.x + (dest ? 24 : 550), target.y + (dest ? 45 : 12), { steps: 15 });
    if (hoverOpen) {
      await page.waitForTimeout(800);
      await expect(card(dest)).toHaveAttribute('data-expanded', 'true');
    }
    await page.mouse.up();
  }
  async function stored() {
    await expect(page.getByTestId('save-state')).toHaveText('项目已保存');
    const p = await page.evaluate(() => window.fileCanvas.restore());
    return p.data;
  }
  const parentName = async (name) => {
    const p = await stored(),
      n = Object.values(p.nodes).find((n) => n.name === name);
    return n.parentId ? p.nodes[n.parentId].name : null;
  };
  await dragCard('预算.csv', '已分类');
  await expect.poll(() => parentName('预算.csv')).toBe('已分类');
  await dragCard('预算.csv', null);
  await expect.poll(() => parentName('预算.csv')).toBe(null);
  await page.keyboard.press('Control+z');
  await expect.poll(() => parentName('预算.csv')).toBe('已分类');
  await page.keyboard.press('Control+z');
  await expect.poll(() => parentName('预算.csv')).toBe('待整理');
  await page.getByRole('button', { name: '收起 已分类', exact: true }).click();
  await dragCard('预算.csv', '已分类', true);
  await expect.poll(() => parentName('预算.csv')).toBe('已分类');
  await page.keyboard.press('Control+z');
  await dragCard('验收标准.txt', '已分类');
  await expect.poll(() => parentName('验收标准.txt')).toBe('已分类');
  await page.keyboard.press('Control+z');
  await page.getByRole('button', { name: '全部收起', exact: true }).click();
  await expect(card('拍摄方案.md')).toHaveCount(0);
  await card('待整理').click();
  await card('已分类').click();
  await page.screenshot({ path: '03_测试结果/expanded-containers.png' });
  pass('开发模式：同屏展开两个目录和嵌套目录，跨容器拖动、拖出至根目录、撤销与折叠后恢复通过');
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click();
  await page.getByLabel('AI 服务地址').fill(endpoint);
  await page.getByLabel('AI 模型名称').fill('local-fixture-model');
  await page.getByRole('button', { name: '保存并测试连接' }).click();
  await expect(page.getByText('连接成功：模型已返回有效文本。')).toBeVisible();
  await page.getByRole('button', { name: '收起 AI 助手' }).click();
  await card('拍摄方案.md').click();
  await expect(page.locator('.text-preview')).toContainText('图书馆');
  await expect(page.locator('.file-ai-consent')).toBeVisible();
  expect(calls).toHaveLength(1);
  await page.locator('.file-ai-consent input').check();
  await expect(page.getByTestId('file-advice')).toContainText('校园拍摄的执行方案');
  await expect(page.locator('.file-recommendation')).toContainText('已分类');
  await expect(card('已分类')).toHaveClass(/recommended-target/);
  expect(JSON.stringify(calls.at(-1))).toContain('项目说明.md');
  await page.getByLabel('继续问这个文件').fill('为什么放到这里？');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await expect(page.locator('.file-followup-answer')).toContainText('项目说明.md');
  await page.screenshot({ path: '03_测试结果/expanded-file-advice.png' });
  await page
    .locator('.content-heading')
    .dragTo(card('已分类'), { targetPosition: { x: 24, y: 45 } });
  await expect.poll(() => parentName('拍摄方案.md')).toBe('已分类');
  await page.locator('.file-inspector .drawer-title').click();
  await page.keyboard.press('Control+z');
  await expect.poll(() => parentName('拍摄方案.md')).toBe('待整理');
  await page.getByRole('button', { name: '采用推荐位置', exact: true }).click();
  await expect.poll(() => parentName('拍摄方案.md')).toBe('已分类');
  expect(digest(await fs.readFile(path.join(root, '待整理', '拍摄方案.md')))).toBe(
    digest(original),
  );
  const openResult = await page.evaluate(async () => {
    const p = (await window.fileCanvas.restore()).data;
    const n = Object.values(p.nodes).find((n) => n.name === '拍摄方案.md');
    return window.fileCanvas.openFile(n.source.path);
  });
  expect(openResult.ok).toBe(true);
  expect(openResult.data.opened).toBe(false);
  expect(openResult.data.method).toBe('system-default');
  pass(
    '点击文件自动解释、项目证据、突出推荐、目标高亮、继续追问、采用建议及外部打开接口通过；模型为本机模拟服务',
  );
  await page.getByRole('button', { name: '收起内容预览' }).click();
  await page.getByRole('button', { name: /检查并应用/ }).click();
  await page.getByRole('button', { name: '应用到本地文件' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(digest(await fs.readFile(path.join(root, '已分类', '拍摄方案.md')))).toBe(
    digest(original),
  );
  await expect(fs.stat(path.join(root, '待整理', '拍摄方案.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await page.getByRole('button', { name: '恢复上次文件移动', exact: true }).click();
  await page.getByRole('button', { name: '恢复文件原位置', exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return digest(await fs.readFile(path.join(root, '待整理', '拍摄方案.md')));
      } catch {
        return null;
      }
    })
    .toBe(digest(original));
  await expect(page.getByRole('status')).toContainText('恢复到原位置');
  pass('确认后普通文件实际移动，原文哈希保持不变；通过界面撤销后原路径恢复');
  await page.setViewportSize({ width: 1000, height: 680 });
  await page.getByRole('button', { name: '展开文件夹', exact: true }).click();
  await card('拍摄方案.md').click();
  await expect(page.locator('.text-preview')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '03_测试结果/expanded-compact.png' });
  expect(errors).toEqual([]);
  await fs.writeFile(
    '03_测试结果/expanded-acceptance.json',
    JSON.stringify(
      {
        status: 'passed',
        assertions,
        root,
        base,
        errors,
        modelTest: 'local fixture; no real provider quality assertion',
        execution: 'Vite development renderer; Electron runtime build only; no EXE packaging',
      },
      null,
      2,
    ),
    'utf8',
  );
} catch (error) {
  if (app) await (await app.firstWindow()).screenshot({ path: '03_测试结果/expanded-failure.png' });
  await fs.writeFile(
    '03_测试结果/expanded-acceptance.json',
    JSON.stringify(
      { status: 'failed', assertions, root, base, errors, error: String(error) },
      null,
      2,
    ),
    'utf8',
  );
  throw error;
} finally {
  if (app) await app.close();
  await vite.close();
  await new Promise((resolve) => api.close(resolve));
}
