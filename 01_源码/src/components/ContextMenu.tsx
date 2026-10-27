import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuItem {
  // Needed only when two items can share a label (two projects with the same name).
  id?: string;
  label: string;
  icon?: ReactNode;
  onClick(): void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  hint?: string;
  // Draws a thin rule above the item to start a new group.
  group?: boolean;
}
// Shared by files, multi-selection and empty space. Scrolling inside the menu
// stays usable; outside clicks, canvas scroll, Escape and focus loss dismiss it.
export function ContextMenu({
  x,
  y,
  items,
  onClose,
  title,
  label = '文件操作',
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
  title?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box)
      setPosition({
        left: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)),
        top: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)),
      });
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, [x, y]);
  useEffect(() => {
    const close = () => onClose();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const scroll = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const buttons = Array.from(
          ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
        );
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'Escape' || event.key === 'Tab') {
          previousFocus.current?.focus({ preventScroll: true });
          onClose();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          buttons[(index + step + buttons.length) % buttons.length]?.focus();
        } else if (event.key === 'Home' || event.key === 'End') {
          event.preventDefault();
          (event.key === 'Home' ? buttons[0] : buttons.at(-1))?.focus();
        }
      }}
    >
      {title && (
        <div className="context-menu-title" title={title}>
          {title}
        </div>
      )}
      {items.map((item) => (
        <div key={item.id ?? item.label}>
          {item.group && <hr role="separator" />}
          <button
            role="menuitem"
            className={item.danger ? 'danger' : ''}
            disabled={item.disabled}
            aria-label={item.label}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon ?? <span className="context-icon-placeholder" aria-hidden="true" />}
            <span className="context-item-copy">
              <span>{item.label}</span>
              {item.hint && <small>{item.hint}</small>}
            </span>
            {item.shortcut && (
              <span className="context-shortcut" aria-hidden="true">
                {item.shortcut}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
