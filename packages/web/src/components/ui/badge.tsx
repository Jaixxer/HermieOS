import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.04em] transition-colors',
  {
    variants: {
      tone: {
        emerald:
          'bg-pill-emerald-bg text-pill-emerald-text border border-pill-emerald-border',
        sky: 'bg-pill-sky-bg text-pill-sky-text border border-pill-sky-border',
        purple:
          'bg-pill-purple-bg text-pill-purple-text border border-pill-purple-border',
        amber: 'bg-pill-amber-bg text-pill-amber-text border border-pill-amber-border',
        rose: 'bg-pill-rose-bg text-pill-rose-text border border-pill-rose-border',
        slate: 'bg-pill-slate-bg text-pill-slate-text border border-pill-slate-border',
      },
      variant: {
        solid: '',
        outline: 'bg-transparent',
        soft: 'border-transparent',
      },
    },
    defaultVariants: { tone: 'slate' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, variant, className }))} {...props} />;
}
