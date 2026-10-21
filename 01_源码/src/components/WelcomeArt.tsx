import { FolderPlus, MousePointer2, ShieldCheck } from 'lucide-react';
import { FileIcon } from './FileIcon';

// Decorative miniature of the canvas for the welcome screen: a loose file being dragged
// into a new folder, with the "nothing moved yet" promise underneath. Purely visual.
export function WelcomeArt() {
  return (
    <div className="wa" aria-hidden="true">
      <div className="wa-window">
        <div className="wa-bar">
          <i />
          <i />
          <i />
          <b>整理画布</b>
          <em>尚未应用 · 4 项变化</em>
        </div>
        <div className="wa-stage">
          <div className="wa-folder">
            <div className="wa-folder-head">
              <FileIcon name="" folder open size={16} />
              <strong>02_创作素材</strong>
              <span>待新建</span>
            </div>
            <div className="wa-folder-body">
              <div className="wa-mini">
                <FileIcon name="版式.svg" size={22} />
                <small>版式.svg</small>
              </div>
              <div className="wa-mini">
                <FileIcon name="课堂.png" size={22} />
                <small>课堂.png</small>
              </div>
            </div>
          </div>
          <div className="wa-card wa-pdf">
            <FileIcon name="合同.pdf" size={28} />
            <small>合同.pdf</small>
          </div>
          <div className="wa-card wa-wav">
            <FileIcon name="配音.wav" size={28} />
            <small>配音.wav</small>
          </div>
          <div className="wa-card wa-drag">
            <FileIcon name="封面.png" size={28} />
            <small>封面草稿.png</small>
          </div>
          <svg className="wa-path" viewBox="0 0 300 200" fill="none">
            <path d="M92 164 C 130 150, 170 120, 206 84" />
          </svg>
          <MousePointer2 className="wa-cursor" size={20} />
          <span className="wa-new">
            <FolderPlus size={13} />
            放进新文件夹
          </span>
        </div>
        <div className="wa-foot">
          <ShieldCheck size={14} />
          本地文件尚未移动，确认后才应用
        </div>
      </div>
    </div>
  );
}
