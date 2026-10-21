import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Layers3,
  MousePointer2,
  ScanEye,
  ShieldCheck,
  Undo2,
  X,
} from 'lucide-react';
import { placeCard, spotlightBox } from '../domain/tour-layout';
import type { Box, CardPlacement } from '../domain/tour-layout';

type Step = {
  id: string;
  /** CSS selector of the real control to highlight; no match -> a centred card. */
  target: string;
  icon: LucideIcon;
  title: string;
  body: string[];
};

export const TOUR_STEPS: Step[] = [
  {
    id: 'canvas',
    target: '.canvas-scroll',
    icon: MousePointer2,
    title: '这是你的整理画布',
    body: [
      '每个文件、文件夹都是一张卡片：点文件夹原地展开，点文件看内容，拖动卡片就是在整理。',
      '现在的所有拖动都只是在“排计划”，硬盘上的真实文件一个都不会动。',
    ],
  },
  {
    id: 'notice',
    target: '[data-tour="notice"]',
    icon: ShieldCheck,
    title: '随时看一眼：文件动了没有',
    body: [
      '这一栏告诉你计划和硬盘是否一致。出现“尚未应用”，说明改动只在画布里，本地文件还没移动。',
      '放心试，不满意按 Ctrl+Z 撤销。',
    ],
  },
  {
    id: 'draft',
    target: '[data-tour="draft"]',
    icon: Layers3,
    title: '不想一个个拖？先出一份草案',
    body: [
      '按内容项目、文件类型、修改月份等方式一键生成分类方案，可以逐组开关，也能在“我的规则”里写自己的规则。',
      '采用后仍只改画布，可以一次撤销。',
    ],
  },
  {
    id: 'apply',
    target: '[data-tour="apply"]',
    icon: ScanEye,
    title: '满意了，再检查并应用',
    body: [
      '这里会逐项列出每个文件“现在在哪 → 将移到哪”，并检查重名和冲突。',
      '确认无误后点“应用到本地文件”，才会真正移动。',
    ],
  },
  {
    id: 'recover',
    target: '[data-tour="more"]',
    icon: Undo2,
    title: '反悔也有办法',
    body: [
      '应用后发现不对？“更多工具 → 恢复上次文件移动”可以把文件放回原位。',
      '这里也能找到“使用说明”和“新手教程”，随时重看。',
    ],
  },
];

const CARD_WIDTH = 344;

export function Tutorial({ onClose }: { onClose(): void }) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [place, setPlace] = useState<CardPlacement | null>(null);
  const [viewport, setViewport] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const step = TOUR_STEPS[index];
  const last = index === TOUR_STEPS.length - 1;
  const Icon = step.icon;

  // Latest handlers for the window-level key listener below.
  const go = useRef({ next() {}, back() {}, close() {} });
  go.current = {
    next: () => (last ? onClose() : setIndex(index + 1)),
    back: () => setIndex(Math.max(0, index - 1)),
    close: onClose,
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') go.current.close();
      else if (event.key === 'ArrowRight') go.current.next();
      else if (event.key === 'ArrowLeft') go.current.back();
      else if (event.key === 'Tab') {
        const items = Array.from(
          card.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [],
        );
        if (!items.length) return;
        const first = items[0],
          end = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          end.focus();
          return;
        }
        if (!event.shiftKey && document.activeElement === end) {
          event.preventDefault();
          first.focus();
          return;
        }
        if (!card.current?.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
          return;
        }
        return;
      } else return;
      // The tour owns these keys; keep the canvas shortcuts behind it quiet.
      event.preventDefault();
      event.stopPropagation();
    }
    window.addEventListener('keydown', keyboard, true);
    return () => window.removeEventListener('keydown', keyboard, true);
  }, []);
  useEffect(() => {
    primary.current?.focus();
  }, [index]);
  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useLayoutEffect(() => {
    const element = document.querySelector<HTMLElement>(step.target);
    const rect = element?.getBoundingClientRect();
    const box = spotlightBox(
      rect ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null,
      viewport,
    );
    const size = card.current?.getBoundingClientRect();
    setSpot(box);
    setPlace(placeCard(box, { width: CARD_WIDTH, height: size?.height ?? 240 }, viewport));
  }, [index, viewport]);

  return (
    <div
      className="tour-layer"
      // Keep keyboard focus on the card when the dimmed area is clicked.
      onMouseDown={(event) => {
        if (!(event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      {spot ? (
        <div
          className="tour-spot"
          style={{ left: spot.x, top: spot.y, width: spot.width, height: spot.height }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      <div
        ref={card}
        className={`tour-card ${place ? `at-${place.placement}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="新手教程"
        style={{
          width: Math.min(CARD_WIDTH, viewport.width - 32),
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          visibility: place ? 'visible' : 'hidden',
        }}
      >
        <div className="tour-meta">
          <span className="tour-count">
            第 {index + 1} 步 / 共 {TOUR_STEPS.length} 步
          </span>
          <span className="tour-dots" aria-hidden="true">
            {TOUR_STEPS.map((s, i) => (
              <i key={s.id} className={i === index ? 'on' : i < index ? 'done' : ''} />
            ))}
          </span>
          <button className="icon-button" aria-label="关闭教程" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="tour-head">
          <span className="tour-icon">
            <Icon size={19} />
          </span>
          <h2>{step.title}</h2>
        </div>
        {step.body.map((text) => (
          <p key={text}>{text}</p>
        ))}
        <div className="tour-actions">
          <button className="text-button" onClick={onClose}>
            跳过教程
          </button>
          <span className="tour-spacer" />
          {index > 0 && (
            <button className="button" onClick={() => setIndex(index - 1)}>
              <ArrowLeft size={14} />
              上一步
            </button>
          )}
          <button ref={primary} className="button primary" onClick={go.current.next}>
            {last ? (
              <>
                <Check size={14} />
                开始整理
              </>
            ) : (
              <>
                下一步
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
