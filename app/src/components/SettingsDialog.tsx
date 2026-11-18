import { RotateCcw } from 'lucide-react';
import { Modal } from './Dialogs';
import {
  DEFAULT_PREFERENCES,
  ICON_PRESETS,
  ICON_SCALE_MAX,
  ICON_SCALE_MIN,
  ICON_SCALE_STEP,
  samePreferences,
} from '../domain/preferences';
import type { CanvasBackground, Preferences, ViewMode } from '../domain/preferences';

const BACKGROUNDS: { id: CanvasBackground; label: string }[] = [
  { id: 'dots', label: '点阵' },
  { id: 'grid', label: '网格' },
  { id: 'plain', label: '纯色' },
];

const VIEWS: { id: ViewMode; label: string }[] = [
  { id: 'canvas', label: '画布' },
  { id: 'tiles', label: '平铺' },
  { id: 'list', label: '列表' },
  { id: 'groups', label: '分组' },
];

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <div className="setting-row">
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className="switch"
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

// Live settings: every change is applied (and saved) at once, so the canvas behind the panel
// shows the result while the slider moves. Nothing here touches the plan or any file.
export function SettingsDialog({
  prefs,
  onChange,
  onReset,
  onClose,
}: {
  prefs: Preferences;
  onChange(patch: Partial<Preferences>): void;
  onReset(): void;
  onClose(): void;
}) {
  const percent = Math.round(prefs.iconScale * 100);
  return (
    <Modal
      side
      title="界面设置"
      subtitle="只改变显示，不会改动任何文件。调整后立即生效并自动保存。"
      onClose={onClose}
    >
      <div className="settings-body">
        <section className="setting-group" aria-label="展示">
          <h3>展示</h3>
          <div className="setting-block">
            <div className="setting-line">
              <span id="view-label">展示方式</span>
            </div>
            <div className="segmented" role="radiogroup" aria-labelledby="view-label">
              {VIEWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.viewMode === item.id}
                  onClick={() => onChange({ viewMode: item.id })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <small className="setting-note">
              画布可自由摆放；平铺、分组、列表按顺序排列，不会改动你在画布上摆好的位置。
            </small>
          </div>
          <div className="setting-block">
            <div className="setting-line">
              <label htmlFor="icon-size">图标大小</label>
              <output htmlFor="icon-size">{percent}%</output>
            </div>
            <input
              id="icon-size"
              type="range"
              aria-label="图标大小"
              min={Math.round(ICON_SCALE_MIN * 100)}
              max={Math.round(ICON_SCALE_MAX * 100)}
              step={Math.round(ICON_SCALE_STEP * 100)}
              value={percent}
              onChange={(event) => onChange({ iconScale: Number(event.target.value) / 100 })}
            />
            <div className="segmented" role="group" aria-label="常用图标大小">
              {ICON_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  aria-pressed={Math.abs(prefs.iconScale - preset.scale) < 0.001}
                  onClick={() => onChange({ iconScale: preset.scale })}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <small className="setting-note">
              在画布上按住 Ctrl 滚动鼠标滚轮，也可以随时调整；列表的缩放幅度较小。
            </small>
          </div>
          <div className="setting-block">
            <div className="setting-line">
              <span id="background-label">画布背景</span>
            </div>
            <div className="segmented" role="radiogroup" aria-labelledby="background-label">
              {BACKGROUNDS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={prefs.background === item.id}
                  onClick={() => onChange({ background: item.id })}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <Toggle
            label="卡片预览"
            hint="显示图片缩略图和文档开头；关闭后只显示图标，文件很多时更轻快。"
            checked={prefs.showPreviews}
            onChange={(showPreviews) => onChange({ showPreviews })}
          />
        </section>
        <section className="setting-group" aria-label="拖放">
          <h3>拖放</h3>
          <Toggle
            label="拖放后对齐到网格"
            hint="默认文件放在松手的位置，可以随意堆放；开启后会自动对齐网格。拖动时按住 Alt 可临时切换。"
            checked={prefs.snapToGrid}
            onChange={(snapToGrid) => onChange({ snapToGrid })}
          />
        </section>
        <section className="setting-group" aria-label="提示与动画">
          <h3>提示与动画</h3>
          <Toggle
            label="整理建议条"
            hint="文件夹里散放文件较多时，在顶部提示一键整理。"
            checked={prefs.showSuggestions}
            onChange={(showSuggestions) => onChange({ showSuggestions })}
          />
          <Toggle
            label="底部操作提示"
            hint="画布下方的快捷操作说明。"
            checked={prefs.showHints}
            onChange={(showHints) => onChange({ showHints })}
          />
          <Toggle
            label="减少动画"
            hint="去掉淡入、滑动等过渡效果。"
            checked={prefs.reduceMotion}
            onChange={(reduceMotion) => onChange({ reduceMotion })}
          />
        </section>
      </div>
      <footer className="modal-footer">
        <button
          type="button"
          className="button"
          disabled={samePreferences(prefs, DEFAULT_PREFERENCES)}
          onClick={onReset}
        >
          <RotateCcw size={14} />
          恢复默认
        </button>
        <button type="button" className="button primary" onClick={onClose}>
          完成
        </button>
      </footer>
    </Modal>
  );
}
