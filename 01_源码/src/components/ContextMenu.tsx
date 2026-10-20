import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick(): void;
  danger?: boolean;
  // Draws a thin rule above the item to start a new group.
  group?: boolean;
}
// A right-click menu for canvas cards. It closes on any outside click, Escape,
// scroll, resize or focus loss, and supports the arrow keys.
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (box)
      setPosition({
        left: Math.max(4, Math.min(x, window.innerWidth - box.width - 4)),
        top: Math.max(4, Math.min(y, window.innerHeight - box.height - 4)),
      });
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);
  useEffect(() => {
    const close = () => onClose();
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="文件操作"
      style={position}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = Array.from(
          ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
        );
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const step = event.key === 'ArrowDown' ? 1 : -1;
          buttons[(index + step + buttons.length) % buttons.length]?.focus();
        }
      }}
    >
      {items.map((item) => (
        <div key={item.label}>
          {item.group && <hr />}
          <button
            role="menuitem"
            className={item.danger ? 'danger' : ''}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        </div>
      ))}
    </div>
  );
}
