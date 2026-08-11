import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import {
  Button as ButtonPrimitive,
  type ButtonProps as ButtonPrimitiveProps,
  Link as LinkPrimitive,
  type LinkProps as LinkPrimitiveProps,
} from "react-aria-components";
import { cn } from "../../lib/class-names";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg border border-transparent bg-clip-padding text-sm font-medium outline-none transition-[background-color,border-color,color,transform] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/45 pressed:translate-y-px disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/85 pressed:bg-primary/75",
        secondary:
          "border-border bg-secondary text-secondary-foreground hover:bg-muted",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "bg-destructive/12 text-destructive hover:bg-destructive/20",
      },
      size: {
        sm: "h-8 gap-1.5 px-3 text-xs",
        md: "h-9 gap-2 px-3.5",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "sm",
    },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: Omit<ButtonPrimitiveProps, "className"> &
  React.RefAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { readonly className?: string }) {
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ variant, size }), className)}
      data-slot="button"
      data-variant={variant ?? "secondary"}
      data-size={size ?? "sm"}
      {...props}
    />
  );
}

export function LinkButton({
  className,
  variant,
  size,
  ...props
}: Omit<LinkPrimitiveProps, "className"> &
  VariantProps<typeof buttonVariants> & { readonly className?: string }) {
  return (
    <LinkPrimitive
      className={cn(buttonVariants({ variant, size }), className)}
      data-slot="button"
      data-variant={variant ?? "secondary"}
      data-size={size ?? "sm"}
      {...props}
    />
  );
}

export { buttonVariants };
