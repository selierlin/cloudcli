import type { SVGProps } from 'react';

// iOS-app-icon-style mark: a smiling cloud linked to a phone (left) and a
// monitor (right). Strokes use `currentColor` so the mark adapts to whatever
// text color surrounds it — e.g. `text-primary-foreground` on a brand-colored
// block, or `text-foreground` on a neutral background.
export const CLOUD_LOGO_PATHS = (
  <>
    {/* Cloud */}
    <path d="M6 11a3.5 3.5 0 0 1 0 -7 4.5 4.5 0 0 1 8.6 -1.4 3.2 3.2 0 0 1 2.4 8.4 Z" />
    {/* Eyes */}
    <circle cx="10" cy="6" r="0.5" fill="currentColor" stroke="none" />
    <circle cx="13" cy="6" r="0.5" fill="currentColor" stroke="none" />
    {/* Smile */}
    <path d="M9.4 7.2q1.3 1.2 3 0" />
    {/* Phone */}
    <rect x="3.6" y="12.2" width="4.4" height="8" rx="1.4" />
    <path d="M5.3 18.4h1.1" />
    {/* Monitor */}
    <rect x="14" y="12.2" width="6.2" height="4.4" rx="0.6" />
    <path d="M17.1 16.6v2.2" />
    <path d="M15.3 18.8h3.6" />
    {/* Connectors */}
    <path d="M7.4 11 5.9 12.2" />
    <path d="M16.4 11 17.1 12.2" />
  </>
);

type CloudLogoProps = SVGProps<SVGSVGElement> & {
  /** Tailwind size classes, e.g. "h-4 w-4". Defaults to h-9 w-9. */
  className?: string;
};

export default function CloudLogo({ className = 'h-9 w-9', ...props }: CloudLogoProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role="img"
      aria-label="CloudCLI"
      {...props}
    >
      {CLOUD_LOGO_PATHS}
    </svg>
  );
}
