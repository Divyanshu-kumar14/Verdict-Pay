"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  block?: boolean;
};

/* Flat fills only. No gradient, no glow, no shadow: a control is a colour. */
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-ground hover:bg-[#5b98e0]",
  secondary: "border border-control bg-raised text-ink hover:bg-[#29282c]",
  ghost: "text-muted hover:bg-raised hover:text-ink",
  danger: "bg-pill-negative text-pill-negative-ink hover:bg-[#38202a]",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-[34px] px-3.5 text-base",
  lg: "h-11 px-5 text-base",
};

/** Single button primitive with loading, icon and disabled states. */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  trailingIcon,
  block = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium",
        "transition-colors duration-120",
        "disabled:cursor-not-allowed disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      ) : (
        icon
      )}
      {children}
      {!loading && trailingIcon ? trailingIcon : null}
    </button>
  );
}
