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

const VARIANTS: Record<Variant, string> = {
  primary: "bg-emerald text-inverse hover:bg-[#4ade80]",
  secondary: "border border-hairline bg-white/[0.03] text-ink hover:bg-white/[0.06]",
  ghost: "text-muted hover:bg-white/[0.04] hover:text-ink",
  danger: "border border-rose/30 bg-rose/10 text-rose hover:bg-rose/15",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-[12px]",
  md: "h-9 px-3.5 text-[13px]",
  lg: "h-11 px-5 text-[13.5px]",
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
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
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