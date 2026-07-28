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
