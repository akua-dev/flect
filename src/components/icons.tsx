import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

const baseProps: IconProps = {
  "aria-hidden": true,
  fill: "none",
  height: 18,
  viewBox: "0 0 24 24",
  width: 18,
};

export function AddIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Add</title>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <svg {...baseProps} height={14} viewBox="0 0 16 16" width={14} {...props}>
      <title>Choose</title>
      <path
        d="m4.75 6.25 3.25 3.5 3.25-3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Send</title>
      <path
        d="m6.5 10.5 5.5-5.5 5.5 5.5M12 5v14"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.9"
      />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Stop</title>
      <rect fill="currentColor" height="8" rx="1.5" width="8" x="8" y="8" />
    </svg>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Refresh</title>
      <path
        d="M19 8.5A7.5 7.5 0 1 0 19.15 15M19 4.75V8.5h-3.75"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <svg {...baseProps} height={16} viewBox="0 0 16 16" width={16} {...props}>
      <title>Search</title>
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="m10.25 10.25 3 3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export function StarIcon({
  filled = false,
  ...props
}: IconProps & { readonly filled?: boolean }) {
  return (
    <svg
      {...baseProps}
      fill={filled ? "currentColor" : "none"}
      height={16}
      viewBox="0 0 16 16"
      width={16}
      {...props}
    >
      <title>{filled ? "Favorite" : "Not favorite"}</title>
      <path
        d="m8 1.8 1.75 3.55 3.92.57-2.84 2.77.67 3.9L8 10.75l-3.5 1.84.67-3.9-2.84-2.77 3.92-.57L8 1.8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function PanelCloseIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Close panel</title>
      <path
        d="M6 6h12v12H6zM15 6v12"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function PanelOpenIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Open panel</title>
      <path
        d="M6 6h12v12H6zM15 6v12M11.5 9.5 9 12l2.5 2.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
