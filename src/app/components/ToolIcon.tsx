// Simple line icons for the measuring tools (24×24, currentColor).
export function ToolIcon({ id, size = 22 }: { id: string; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    'aria-hidden': true,
  };
  switch (id) {
    case 'ruler':
      return (
        <svg {...p}>
          <rect x="2" y="8" width="20" height="8" rx="1" />
          <path d="M5 8v3M8 8v2M11 8v3M14 8v2M17 8v3M20 8v2" />
        </svg>
      );
    case 'gapRuler':
      return (
        <svg {...p}>
          <rect x="2" y="3" width="20" height="4" rx="1" />
          <rect x="2" y="17" width="20" height="4" rx="1" />
          <path d="M12 8v8M10 10l2-2 2 2M10 14l2 2 2-2" />
        </svg>
      );
    case 'splitRuler':
      return (
        <svg {...p}>
          <rect x="2" y="6" width="20" height="12" rx="1" />
          <path d="M5 6v3M9 6v2M13 6v3M17 6v2M5 18v-3M10 18v-2M15 18v-3M20 18v-2M12 3v18" />
        </svg>
      );
    case 'leapfrog':
      return (
        <svg {...p}>
          <rect x="2" y="13" width="9" height="5" rx="1" />
          <rect x="13" y="13" width="9" height="5" rx="1" opacity="0.55" />
          <path d="M6 10c2-5 9-5 11 0M15 8.5l2 1.5.5-2.4" />
        </svg>
      );
    case 'free':
      return (
        <svg {...p}>
          <rect x="3" y="4" width="18" height="5" rx="1" />
          <rect x="9.5" y="9" width="5" height="12" rx="1" />
          <path d="M6 4v2M9 4v1.5M12 4v2M15 4v1.5M18 4v2" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
        </svg>
      );
  }
}
