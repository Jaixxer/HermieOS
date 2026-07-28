import * as React from 'react';
import { cn } from '../../lib/utils';

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  variant?: 'default' | 'in-button';
}

/**
 * <Kbd> — small monospace key cap. Used in command palette rows and toolbars.
 * Visually evokes a physical key cap via subtle inner shadow + ring.
 */
export const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, variant = 'default', ...props }, ref) => {
    return (
      <kbd
        ref={ref as React.Ref<HTMLDivElement>}
        className={cn(
          'inline-flex items-center justify-center font-mono tabular-nums',
          variant === 'in-button'
            ? 'px-1 py-0 text-[9.5px] leading-[14px] rounded bg-black/20 text-current'
            : 'px-1.5 py-0.5 text-[10px] leading-[14px] rounded bg-surface-3 text-text-tertiary border border-border-default shadow-[inset_0_-1px_0_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.04)]',
          className,
        )}
        {...(props as React.HTMLAttributes<HTMLDivElement>)}
      />
    );
  },
);
Kbd.displayName = 'Kbd';
