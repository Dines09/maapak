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
    strokeLinejoin: 'round' as const,
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
    case 'box':
      return (
        <svg {...p}>
          <path d="M7 2v20M17 2v20M2 7h20M2 17h20" />
          <rect x="7" y="7" width="10" height="10" fill="currentColor" opacity="0.18" stroke="none" />
        </svg>
      );
    case 'caliper':
      return (
        <svg {...p}>
          <rect x="2" y="7" width="20" height="4" rx="0.8" />
          <path d="M4 11v9l2-2v-7M12 11v9l-2-2v-7M4 7V3M12 7V4.5M10 11h6v3h-6" />
        </svg>
      );
    case 'protractor':
      return (
        <svg {...p}>
          <path d="M3 18a9 9 0 0 1 18 0z" />
          <path d="M12 18 18 9M12 15v3M7 13l1 1M17 13l-1 1" />
        </svg>
      );
    case 'circle':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <path d="M4 12h16M12 9v6" />
        </svg>
      );
    case 'ring':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
        </svg>
      );
    case 'hex':
      return (
        <svg {...p}>
          <path d="M7.5 4.2h9L21 12l-4.5 7.8h-9L3 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'rect':
      return (
        <svg {...p}>
          <rect x="3" y="6" width="18" height="12" rx="1" />
          <path d="M3 3.5h18M3 2.5v2M21 2.5v2" />
        </svg>
      );
    case 'polygon':
      return (
        <svg {...p}>
          <path d="M4 18 6 6l8-2 6 7-4 8z" />
          <circle cx="6" cy="6" r="1" />
          <circle cx="14" cy="4" r="1" />
          <circle cx="20" cy="11" r="1" />
        </svg>
      );
    case 'threadGauge':
      return (
        <svg {...p}>
          <path d="M3 9h18M3 9l2 5 2-5 2 5 2-5 2 5 2-5 2 5 2-5 2 5" />
          <path d="M3 19h18" />
        </svg>
      );
    case 'wireGauge':
      return (
        <svg {...p}>
          <path d="M3 8h18M3 16h18" />
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 3v2M12 19v2" />
        </svg>
      );
    case 'radiusGauge':
      return (
        <svg {...p}>
          <path d="M4 20V10a6 6 0 0 1 6-6h10" />
          <path d="M8 20v-9a3 3 0 0 1 3-3h9" opacity="0.55" />
        </svg>
      );
    case 'grid':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="18" height="18" rx="1" />
          <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
        </svg>
      );
    case 'datumXY':
      return (
        <svg {...p}>
          <path d="M4 20V4M4 20h16M2.5 6 4 4l1.5 2M18 18.5l2 1.5-2 1.5" />
          <circle cx="11" cy="13" r="1.2" />
          <circle cx="16" cy="8" r="1.2" />
        </svg>
      );
    case 'level':
      return (
        <svg {...p}>
          <rect x="2" y="8" width="20" height="8" rx="4" />
          <circle cx="12" cy="12" r="2" />
          <path d="M8.5 9v6M15.5 9v6" />
        </svg>
      );
    case 'bolt':
      return (
        <svg {...p}>
          <path d="M7 3h10v4H7z" />
          <path d="M10 7v14h4V7M10 10l4 1.5M10 13l4 1.5M10 16l4 1.5" />
        </svg>
      );
    case 'identify':
      return (
        <svg {...p}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m15.5 15.5 5 5M8.5 8.6a2 2 0 1 1 2.6 2.1c-.6.3-.6.8-.6 1.3M10.5 14v.01" />
        </svg>
      );
    case 'shapes':
      return (
        <svg {...p}>
          <path d="M5.5 3h5L13 7.5 10.5 12h-5L3 7.5z" />
          <circle cx="17" cy="7" r="4" />
          <rect x="4" y="14" width="7" height="7" rx="1" />
          <circle cx="17" cy="17.5" r="3.5" />
          <circle cx="17" cy="17.5" r="1.5" />
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
