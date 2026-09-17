import * as React from 'react';
import { OrbitGlyph } from './OrbitGlyph';
import { cn } from '../lib/utils';

export function Loading({
  text = 'Hermes is loading…',
  className,
}: {
  text?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 p-8', className)}>
      <div className="text-[#bfa15f]">
        <OrbitGlyph size={48} animate />
      </div>
      <p className="text-[13px] text-text-tertiary tracking-wide">{text}</p>
    </div>
  );
}

export function PageLoader({ text }: { text?: string }): React.JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center bg-page">
      <Loading text={text} />
    </div>
  );
}

/**
 * Fallback while a lazily-loaded route chunk arrives. Deliberately plain — it
 * renders inside the app shell (which is already painted), so it must not cost
 * more than the page it is standing in for.
 */
export function RouteFallback(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-10"
    >
      <div className="flex items-center gap-2.5 font-mono text-[10px] tracking-[0.2em] text-p5-dark-muted">
        <span className="h-2 w-2 rounded-full bg-accent" />
        LOADING
      </div>
    </div>
  );
}
