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

export function CapabilitiesIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Capabilities</title>
      <path
        d="M8.25 4.75v3.5h-3.5m14.5 0h-3.5v-3.5m0 14.5v-3.5h3.5m-14.5 0h3.5v3.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
      <circle
        cx="12"
        cy="12"
        r="2.25"
        stroke="currentColor"
        strokeWidth="1.7"
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

export function MicrophoneIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Voice</title>
      <rect
        height="10"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.7"
        width="6"
        x="9"
        y="3"
      />
      <path
        d="M6.5 10.75v.5a5.5 5.5 0 0 0 11 0v-.5M12 16.75V21m-3 0h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps) {
  return (
    <svg {...baseProps} {...props}>
      <title>Shape</title>
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
