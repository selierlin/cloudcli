/**
 * The copy control an exported document keeps.
 *
 * It carries no handler of its own: the document's click listener reads the
 * text from the surrounding `[data-export-copy-group]` (a code block or table)
 * or, failing that, from the message row's `[data-export-copy-source]`. Unlike
 * the chat's copy, which a pointer reveals, this one is always visible — a
 * static page has no hover to wait for.
 */
const ExportCopyButton = ({
  label,
  className,
  iconClassName = 'h-3.5 w-3.5',
}: {
  label: string;
  className: string;
  iconClassName?: string;
}) => (
  <button
    type="button"
    data-export-copy=""
    title={label}
    aria-label={label}
    className={className}
  >
    <svg
      className={`chat-export-copy-icon ${iconClassName}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
    <svg
      className={`chat-export-copy-check ${iconClassName}`}
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  </button>
);

export default ExportCopyButton;
