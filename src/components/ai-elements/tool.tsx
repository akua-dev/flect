"use client";

import {
  CheckCircleIcon,
  ChevronDownIcon,
  CircleIcon,
  ClockIcon,
  WrenchIcon,
  XCircleIcon,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/class-names";

export type ToolState =
  | "approval-requested"
  | "approval-responded"
  | "input-available"
  | "input-streaming"
  | "output-available"
  | "output-denied"
  | "output-error";

export type ToolPart = { state: ToolState };
export type ToolProps = ComponentProps<typeof Collapsible>;

export const Tool = ({ className, ...props }: ToolProps) => (
  <Collapsible
    className={cn("group not-prose mb-4 w-full rounded-md border", className)}
    {...props}
  />
);

const statusLabels: Record<ToolState, string> = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error",
};

const statusIcons: Record<ToolState, ReactNode> = {
  "approval-requested": <ClockIcon className="size-4 text-yellow-600" />,
  "approval-responded": <CheckCircleIcon className="size-4 text-blue-600" />,
  "input-available": <ClockIcon className="size-4 animate-pulse" />,
  "input-streaming": <CircleIcon className="size-4" />,
  "output-available": <CheckCircleIcon className="size-4 text-green-600" />,
  "output-denied": <XCircleIcon className="size-4 text-orange-600" />,
  "output-error": <XCircleIcon className="size-4 text-red-600" />,
};

export const getStatusBadge = (status: ToolState) => (
  <Badge className="gap-1.5 rounded-full text-xs" variant="secondary">
    {statusIcons[status]}
    {statusLabels[status]}
  </Badge>
);

export type ToolHeaderProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string;
  state: ToolState;
  description?: ReactNode;
  meta?: ReactNode;
};

export const ToolHeader = ({
  className,
  title,
  state,
  description,
  meta,
  ...props
}: ToolHeaderProps) => (
  <CollapsibleTrigger
    className={cn(
      "flex w-full items-center justify-between gap-4 p-3",
      className,
    )}
    {...props}
  >
    <div className="flex min-w-0 items-center gap-2">
      <WrenchIcon className="size-4 text-muted-foreground" />
      <span className="font-medium text-sm">{title}</span>
      {getStatusBadge(state)}
      {description && (
        <code className="truncate text-muted-foreground text-xs">
          {description}
        </code>
      )}
    </div>
    <div className="flex shrink-0 items-center gap-2 text-muted-foreground text-xs">
      {meta}
      <ChevronDownIcon className="size-4 transition-transform group-data-[state=open]:rotate-180" />
    </div>
  </CollapsibleTrigger>
);

export type ToolContentProps = ComponentProps<typeof CollapsibleContent>;

export const ToolContent = ({ className, ...props }: ToolContentProps) => (
  <CollapsibleContent
    className={cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className,
    )}
    {...props}
  />
);
