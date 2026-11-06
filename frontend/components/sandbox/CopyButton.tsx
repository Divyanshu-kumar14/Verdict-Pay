"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * Copies an identifier or hash to the clipboard. Renders the truncated value
 * the caller passes as children and copies the full value, so long hashes
 * stay readable while the exact bytes remain one click away.
 */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onCopy()}
      title={value}
      aria-label={"Copy " + label + ": " + value}
      className={cn(
        "num inline-flex max-w-full items-center gap-1 rounded-md border border-line bg-ground px-1.5 py-0.5",
        "font-mono text-xs text-muted transition-colors duration-150 hover:border-control hover:text-ink",
        "focus-visible:outline-2 focus-visible:outline-accent",
        className,
      )}
    >
      <span className="truncate">{label}</span>
      {copied ? (
        <Check size={11} aria-hidden className="shrink-0 text-positive" />
      ) : (
        <Copy size={11} aria-hidden className="shrink-0 opacity-60" />
      )}
      <span className="sr-only" role="status">
        {copied ? "Copied" : ""}
      </span>
    </button>
  );
}
