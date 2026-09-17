import * as React from 'react';
import { cn } from '../lib/utils';
// 192x128 WebP (3.6 kB) — the source PNG was 1536x1024 / 136 kB for a 40px badge.
import logoUrl from '../assets/logo.webp';

export interface LogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  size?: number;
  badge?: boolean;
  className?: string;
}

export function Logo({ size = 40, badge = true, className, ...props }: LogoProps): React.JSX.Element {
  const img = (
    <img
      src={logoUrl}
      alt="HermieOS"
      width={size}
      height={size}
      className={cn('shrink-0 object-contain', !badge && className)}
      {...props}
    />
  );
  if (!badge) return img;
  return (
    <div
      className={cn(
        'shrink-0 rounded-xl bg-[#0a0a0a] flex items-center justify-center shadow-sm ring-1 ring-black/5',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {img}
    </div>
  );
}

export function Wordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col', className)}>
      <div className="text-[15px] font-semibold tracking-[0.12em] text-text-primary leading-none">
        HERMIE<span className="text-[#bfa15f]">OS</span>
      </div>
      <div className="text-[10px] tracking-[0.18em] text-text-tertiary uppercase mt-0.5 leading-none">
        Personal OS
      </div>
    </div>
  );
}
