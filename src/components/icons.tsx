import type { ReactNode } from "react";

export type IconName =
  | "box"
  | "braces"
  | "check"
  | "chevron"
  | "copy"
  | "download"
  | "file"
  | "focus"
  | "grid"
  | "layers"
  | "play"
  | "rotate"
  | "scan"
  | "settings"
  | "spark"
  | "split"
  | "upload"
  | "wrench";

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, ReactNode> = {
    box: (
      <>
        <path d="m3 6 9-4 9 4-9 4-9-4Z" />
        <path d="m3 6 9 4 9-4v11l-9 5-9-5V6Z" />
        <path d="M12 10v12" />
      </>
    ),
    braces: (
      <>
        <path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2" />
        <path d="M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 1-2 2v4a2 2 0 0 1-2 2h-2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    chevron: <path d="m9 18 6-6-6-6" />,
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h5" />
      </>
    ),
    focus: (
      <>
        <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      </>
    ),
    layers: (
      <>
        <path d="m12 2 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
      </>
    ),
    play: <path d="m7 4 13 8-13 8V4Z" />,
    rotate: (
      <>
        <path d="M20 7h-5V2" />
        <path d="M20 7a9 9 0 1 0 1 9" />
      </>
    ),
    scan: (
      <>
        <path d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2" />
        <path d="M7 12h10" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.09a1.7 1.7 0 0 0 1.5 1.51 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h.09v4H21a1.7 1.7 0 0 0-1.6 1Z" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3-1.4 4.2a5 5 0 0 1-3.2 3.2L3 12l4.4 1.6a5 5 0 0 1 3.2 3.2L12 21l1.4-4.2a5 5 0 0 1 3.2-3.2L21 12l-4.4-1.6a5 5 0 0 1-3.2-3.2L12 3Z" />
      </>
    ),
    split: (
      <>
        <path d="M3 12h4l3-9 4 18 3-9h4" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M4 20h16" />
      </>
    ),
    wrench: (
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z" />
    ),
  };
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
