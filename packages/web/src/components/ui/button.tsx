import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-[13px] font-medium ring-offset-surface-0 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-accent text-accent-fg font-semibold shadow-sm hover:bg-accent-hover active:translate-y-px',
        secondary:
          'bg-surface-2 text-text-primary border border-border-default hover:bg-surface-3 hover:border-border-strong',
        outline:
          'border border-border-default bg-surface-0 text-text-secondary hover:bg-surface-2 hover:text-text-primary',
        ghost:
          'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
        glass:
          'bg-surface-1 text-text-primary border border-border-default hover:bg-surface-2',
        destructive:
          'bg-pill-rose-bg text-pill-rose-text border border-pill-rose-border hover:bg-rose-50',
        link:
          'text-accent-text underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-8 px-3',
        sm: 'h-7 px-2.5 text-[12px]',
        lg: 'h-9 px-4',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
