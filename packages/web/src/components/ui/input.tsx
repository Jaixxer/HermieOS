import * as React from 'react';
import { cn } from '../../lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-lg border border-border-default bg-surface-0 px-3 py-1.5 text-[13px] text-text-primary placeholder:text-text-quaternary transition-colors',
          'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
    <textarea
    className={cn(
      'flex min-h-[60px] w-full rounded-lg border border-border-default bg-surface-0 px-3 py-2 text-[13px] text-text-primary placeholder:text-text-quaternary transition-colors',
      'focus-visible:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30',
      'disabled:cursor-not-allowed disabled:opacity-50 resize-none',
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
