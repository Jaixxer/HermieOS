import * as React from 'react';
import { cn } from '../lib/utils';

export interface OrbitGlyphProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  animate?: boolean;
}

/**
 * Scout glyph inspired by the HermieOS brand mark.
 * Two tilted orbital rings around a central point.
 */
export function OrbitGlyph({ size = 24, animate = false, className, ...props }: OrbitGlyphProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={cn(animate && 'animate-spin-slow', className)}
      style={{ animationDuration: animate ? '8s' : undefined }}
      {...props}
    >
      {/* Outer ring */}
      <ellipse
        cx="24"
        cy="24"
        rx="18"
        ry="8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
        transform="rotate(30 24 24)"
      />
      {/* Inner ring */}
      <ellipse
        cx="24"
        cy="24"
        rx="12"
        ry="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
        transform="rotate(-20 24 24)"
      />
      {/* Center core */}
      <circle cx="24" cy="24" r="3" fill="currentColor" />
      {/* Orbiting dots */}
      <circle cx="38" cy="20" r="2" fill="#5eead4" opacity="0.9" />
      <circle cx="14" cy="30" r="1.5" fill="#a5b4fc" opacity="0.9" />
    </svg>
  );
}
