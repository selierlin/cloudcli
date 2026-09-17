type OpenCodeLogoProps = {
  className?: string;
};

/** Rendered by the shared LLMProviderLogo when the provider is OpenCode.
 * The viewBox is the tile's own bounds (the original artwork sat at 2.5,2.5 with
 * ~10% padding on every side), so the tile fills the square slot like Claude/Pi. */
const OpenCodeLogo = ({ className = 'w-5 h-5' }: OpenCodeLogoProps) => (
  <svg
    viewBox="2.5 2.5 19 19"
    role="img"
    aria-label="OpenCode"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="2.5" y="2.5" width="19" height="19" rx="4" className="fill-foreground" />
    <path
      d="M8.1 8.1 4.9 12l3.2 3.9M15.9 8.1l3.2 3.9-3.2 3.9M13.2 6.9l-2.4 10.2"
      className="stroke-background"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default OpenCodeLogo;
