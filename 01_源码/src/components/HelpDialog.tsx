import { useEffect, useState } from 'react';
import { FileText, GraduationCap } from 'lucide-react';
import type { AppInfo } from '../domain/types';
import { Modal } from './Dialogs';

export function HelpDialog({
  onTutorial,
  onClose,
  notify,
}: {
  onTutorial(): void;
  onClose(): void;
  notify(message: string): void;
}) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void window.fileCanvas
      ?.appInfo()
      .then((result) => result.ok && setInfo(result.data ?? null))
      .catch(() => {});
  }, []);
  return (
    <Modal title="先虚拟整理，再核对结果" onClose={onClose}>
      <div className="help-content">
        <p className="help-tutorial">
          刚上手？
          <button className="text-button" onClick={onTutorial}>
            <GraduationCap size={14} />
            跟着 5 步新手教程走一遍
          </button>
        </p>
        <p>
          <strong>1. 打开文件夹</strong>
          <br />
          文件自动加入画布，随时可以把新的文件夹拖进窗口打开。文件卡片显示类型与大小；文件夹显示已加入画布的文件数量、合计大小和主要类型。再次打开同一个文件夹会回到它的项目，未应用的计划不会丢。
        </p>
        <p>
          <strong>2. 拖动整理，或自动分类</strong>
          <br />
          点文件夹可同屏展开；拖入文件夹即可归类。右键文件可预览、改名或移动，多选后右键可批量处理。右键文件夹可新建子文件夹，右键空白处可新建、全选和排列。不用右键时，可点选中栏的“操作”或“画布选项”。“自动分类”默认按类型。
        </p>
        <p>
          <strong>3. 预览并应用</strong>
          <br />
          拖动先修改计划，本地文件保持原位。满意后点击“预览并应用”，核对原路径和目标路径，再点“应用到本地文件”执行。支持同一本地目录内的移动、改名和新建分类目录；有问题的条目排在最前面。
        </p>
        <p>
          <strong>4. 撤销与恢复</strong>
          <br />
          Ctrl+Z / Ctrl+Y
          撤销和重做尚未应用的修改。已经应用到本地的操作，用“恢复上次文件移动”放回原处。遇到冲突或外部编辑时会停止并提示。
        </p>
        <p>
          <strong>5. 需要时再打开辅助工具</strong>
          <br />
          “更多工具”里提供原始文件栏、AI
          助手、刷新、已保存项目和界面设置（Ctrl+,）。常用视图为画布和列表，平铺、分组可在设置里选择。画布的批量展开和按类型排列在“画布选项”中。
        </p>
        <p>
          Ctrl+O 打开文件夹，F5 刷新核对，Ctrl+F 筛选文件，Ctrl / Shift 多选，F2
          改名，多选时可批量改名。“移出画布”的条目刷新后不会自动回来，需要时可从原始文件栏加回。只想把相关文件归在一起、不移动它们时，右键选“加入新文件集…”，之后可以打包为
          ZIP
          或复制到别处。项目自动保存；重启后保留整理计划，撤销历史从本次打开重新开始。文件夹合计仅涵盖画布内文件，不代表磁盘全部占用。
        </p>
        {info && (
          <p className="help-about" data-testid="app-about">
            FileCanvas {info.version} · 数据保存在本机：<code>{info.dataPath}</code>
            <button
              className="text-button"
              onClick={() =>
                void window.fileCanvas
                  .revealLogs()
                  .then((result) => {
                    if (!result.ok) notify(result.error ?? '无法打开日志文件夹。');
                  })
                  .catch(() => notify('无法打开日志文件夹。'))
              }
            >
              <FileText size={14} />
              打开日志文件夹
            </button>
          </p>
        )}
      </div>
    </Modal>
  );
}
