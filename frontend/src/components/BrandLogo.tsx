import { useId } from "react";

interface BrandProps { size?: number; variant?: "dark" | "light"; }

export function BrandMark({ size = 26 }: BrandProps) {
  const gid = useId().replace(/:/g, "");
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id={gid} x1="5" y1="2" x2="27" y2="30" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#3d7bff" />
        <stop offset="1" stopColor="#7b3dff" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="30" height="30" rx="8" fill={`url(#${gid})`} />
    <g transform="translate(4.4 4.4) scale(0.97)" fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round">
      <path d="M9.6 4.6A2 2 0 1 1 11 8H2" />
      <path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2" />
      <path d="M12.6 19.4A2 2 0 1 0 14 16H2" />
    </g>
  </svg>;
}

export default function BrandLogo({ size = 26, variant = "dark" }: BrandProps) {
  return <span className={`brand-logo brand-${variant}`}>
    <BrandMark size={size} />
    <span className="brand-wordmark">xx可视化</span>
  </span>;
}
