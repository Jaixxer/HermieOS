/**
 * Sheet — bottom sheet on phones, centered dialog on sm+ screens.
 *
 * The mobile replacement for centered modals: slides from the bottom,
 * dismisses via backdrop, close button, Escape, or drag-down on the
 * handle. Content scrolls (`92dvh` cap); pass `footer` for a sticky
 * action bar that respects the bottom safe area.
 *
 * Rendered via portal to document.body: page content routinely carries
 * transforms/filters (entrance animations, drop shadows, GSAP), and any
 * of those on an ancestor would trap `position: fixed` inside the card
 * instead of the viewport.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

export function Sheet({
  open,
  onClose,
  label,
  children,
  footer,
  className,
  footerClassName,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  footerClassName?: string;
}): React.JSX.Element | null {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ y: number; dy: number } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const onTouchStart = (e: React.TouchEvent): void => {
    const t = e.touches[0];
    if (t) drag.current = { y: t.clientY, dy: 0 };
  };
  const onTouchMove = (e: React.TouchEvent): void => {
    if (!drag.current || !panelRef.current) return;
    const t = e.touches[0];
    if (!t) return;
    const dy = Math.max(0, t.clientY - drag.current.y);
    drag.current.dy = dy;
    panelRef.current.style.transform = `translateY(${dy}px)`;
  };
  const onTouchEnd = (): void => {
    if (panelRef.current) panelRef.current.style.transform = '';
    if (drag.current && drag.current.dy > 110) onClose();
    drag.current = null;
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        type="button"
        aria-label={`Close ${label}`}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-p5-ink/70"
      />
      <div
        ref={panelRef}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-p5-cream text-p5-dark sm:max-w-lg sm:rounded-none',
          className,
        )}
      >
        <div
          className="flex shrink-0 items-center justify-center pt-2.5 sm:hidden"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          <span className="h-1 w-10 rounded-full bg-black/25" aria-hidden />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? (
          <div
            className={cn('shrink-0 border-t border-black/10 bg-p5-cream p-4', footerClassName)}
            style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
