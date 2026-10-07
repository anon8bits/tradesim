import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "aria-hidden": true,
} as const;

export const MarketIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.7} {...props}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" />
    <rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

export const StockIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.7} {...props}>
    <path d="M3 15l5-6 4 4 9-10" />
    <circle cx="21" cy="3" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const PortfolioIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.7} {...props}>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const OrdersIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.7} {...props}>
    <path d="M4 7h13M13 3l4 4-4 4" />
    <path d="M20 17H7M11 21l-4-4 4-4" />
  </svg>
);

export const ProfileIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.7} {...props}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M4.5 20c1.6-3.6 4.6-5.4 7.5-5.4s5.9 1.8 7.5 5.4" />
  </svg>
);

export const SearchIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={2} {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const ChevronIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={2} className="chev" {...props}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const InfoIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.8} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5v.5" strokeLinecap="round" />
  </svg>
);

export const AlertIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.8} {...props}>
    <path d="M12 3l9.5 17h-19L12 3z" strokeLinejoin="round" />
    <path d="M12 10v4M12 17v.5" strokeLinecap="round" />
  </svg>
);

export const TrendIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.6} {...props}>
    <path d="M3 17l5-5 4 3 7-8" />
    <path d="M15 7h4v4" />
  </svg>
);

export const LedgerIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.6} {...props}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M4 10h16M10 4v16" />
  </svg>
);

export const BarsIcon = (props: IconProps) => (
  <svg {...base} strokeWidth={1.6} {...props}>
    <path d="M4 19V9M12 19V5M20 19v-7" />
  </svg>
);
