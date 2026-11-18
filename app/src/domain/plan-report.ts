import type { Preview, Project } from './types';

export function relativePath(root: string, full: string): string {
  const base = root.replace(/[\\/]+$/, '');
  return full.toLowerCase().startsWith(`${base.toLowerCase()}\\`) ||
    full.toLowerCase().startsWith(`${base.toLowerCase()}/`)
    ? full.slice(base.length + 1).replaceAll('\\', '/')
    : full.replaceAll('\\', '/');
}
export function structureTree(paths: string[], maxLines = 600): string {
  interface Branch {
    name: string;
    children: Map<string, Branch>;
  }
  const root: Branch = { name: '.', children: new Map() };
  for (const p of paths) {
    let branch = root;
    for (const part of p.split(/[\\/]/).filter(Boolean)) {
      if (!branch.children.has(part))
        branch.children.set(part, { name: part, children: new Map() });
      branch = branch.children.get(part)!;
    }
  }
  const lines = ['.'];
  function visit(branch: Branch, prefix: string) {
    const items = [...branch.children.values()].sort(
      (a, b) =>
        Number(!!b.children.size) - Number(!!a.children.size) ||
        a.name.localeCompare(b.name, 'zh-CN'),
    );
    for (const [index, item] of items.entries()) {
      if (lines.length >= maxLines) return;
      const last = index === items.length - 1;
      lines.push(`${prefix}${last ? '└─ ' : '├─ '}${item.name}`);
      visit(item, `${prefix}${last ? '   ' : '│  '}`);
    }
  }
  visit(root, '');
  if (lines.length >= maxLines) lines.push('… 视图已截断；请查看逐项清单');
  return lines.join('\n');
}
export function planTrees(preview: Preview, root: string): { before: string; after: string } {
  return {
    before: structureTree(
      preview.changes.flatMap((c) => (c.source ? [relativePath(root, c.source)] : [])),
    ),
    after: structureTree(preview.changes.map((c) => relativePath(root, c.target))),
  };
}
const labels = {
  create: '创建目录（计划）',
  move: '移动（计划）',
  rename: '重命名（计划）',
  'move-rename': '移动并重命名（计划）',
  unchanged: '路径无变化',
};
function tableCell(text: string): string {
  return text
    .replaceAll('|', '\\|')
    .replace(/[\r\n]/g, ' ')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
export function markdownPlan(project: Project, preview: Preview): string {
  const trees = planTrees(preview, project.rootPath);
  const fence = '`'.repeat(
    Math.max(
      3,
      ...[...trees.before.matchAll(/`+/g), ...trees.after.matchAll(/`+/g)].map(
        (m) => m[0].length + 1,
      ),
    ),
  );
  const rows = preview.changes.map(
    (c) =>
      `| ${labels[c.kind]} | ${tableCell(c.source ? relativePath(project.rootPath, c.source) : '—')} | ${tableCell(relativePath(project.rootPath, c.target))} | ${tableCell(c.issues.join('；') || '未发现已检查类型的问题')} |`,
  );
  return [
    '# FileCanvas 整理方案',
    '',
    '**状态：仅为虚拟规划，未执行真实文件操作。**',
    '',
    `项目：${tableCell(project.name)}`,
    `检查时间：${preview.checkedAt}`,
    '',
    `待变更条目：${preview.changed}；路径未改变：${preview.unchanged}；需要检查：${preview.issues}。`,
    '',
    '所有路径相对于所选根目录。方案包含文件名，不包含源文件内容；分享前请核对文件名。',
    '',
    '## 整理前（已加入的源条目）',
    '',
    fence + 'text',
    trees.before,
    fence,
    '',
    '## 拟整理后',
    '',
    fence + 'text',
    trees.after,
    fence,
    '',
    '## 逐项核对',
    '',
    '| 类型 | 原路径 | 拟目标路径 | 检查结果 |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## 边界',
    '',
    '只包含已加入画布的条目，未加入的文件不在方案内。画布坐标不参与路径变更。',
    '目标存在即标为冲突，不允许覆盖；检查结果只对应上述时间。源变化检查使用大小与修改时间，不等于完整内容校验。',
    '当前版本未开放真实移动与恢复。本文件不是可直接执行的脚本，也不能证明真实整理已经完成。',
    '',
  ].join('\n');
}
