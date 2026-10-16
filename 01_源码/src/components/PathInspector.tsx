import { ArrowRight, ShieldCheck } from 'lucide-react';
import type { NodeMap } from '../domain/types';
import { relativeTarget } from '../domain/workspace';
import { relativePath } from '../domain/plan-report';

export function PathInspector({
  nodes,
  selected,
  root,
}: {
  nodes: NodeMap;
  selected: string[];
  root: string;
}) {
  const node = selected.length === 1 ? nodes[selected[0]] : undefined;
  if (!node)
    return (
      <div className="path-inspector quiet">
        <ShieldCheck size={15} />
        <span>
          {selected.length > 1
            ? `选中 ${selected.length} 项，可一起分类或移动；预览中核对逐项路径。`
            : '选中一张卡片，核对“原始位置 → 拟放位置”。自由排列只保存坐标。'}
        </span>
      </div>
    );
  const from = node.source ? relativePath(root, node.source.path) : '尚未创建（虚拟文件夹）';
  const to = relativeTarget(nodes, node.id).join('/');
  const unchanged = !!node.source && from === to;
  return (
    <div className="path-inspector" data-testid="path-inspector">
      <div>
        <small>原始位置</small>
        <code title={from}>{from}</code>
      </div>
      <ArrowRight size={16} />
      <div>
        <small>拟放位置</small>
        <code title={to}>{to}</code>
      </div>
      <span className={`tag ${unchanged ? 'neutral' : ''}`}>
        {unchanged ? '路径未变 · 只改布局' : '路径规划 · 尚未执行'}
      </span>
    </div>
  );
}
