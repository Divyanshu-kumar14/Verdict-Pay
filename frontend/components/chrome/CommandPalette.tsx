"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { BarChart3, CalendarClock, CornerDownLeft, Play, Scale, Settings } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/cn";
import { SPRING_SOFT } from "@/lib/motion";

type Item = { href: string; label: string; group: string; icon: LucideIcon };

const ITEMS: Item[] = [
  { href: "/disputes", label: "Disputes", group: "Dashboard", icon: Scale },
  { href: "/timeline", label: "SLA board", group: "Dashboard", icon: CalendarClock },
  { href: "/analytics", label: "Analytics", group: "Dashboard", icon: BarChart3 },
  { href: "/settings", label: "Connection & settings", group: "Dashboard", icon: Settings },
  { href: "/demo", label: "Run the live demo", group: "Simulation", icon: Play },
];

function match(query: string, item: Item): boolean {
  if (query.trim() === "") return true;
  return item.label.toLowerCase().includes(query.trim().toLowerCase());
}

/** ⌘K navigation palette. Springs in over a scrim, filters five destinations,
 *  and supports full keyboard nav (↑/↓/Enter/Esc). */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => ITEMS.filter((item) => match(query, item)), [query]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A "Search" button in the shell opens the palette without a ⌘K chord.
  useEffect(() => {
    function onOpenPalette() {
      setOpen(true);
    }
    window.addEventListener("vp-open-palette", onOpenPalette);
    return () => window.removeEventListener("vp-open-palette", onOpenPalette);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      const timer = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Reset the highlighted index whenever the filtered list changes.
  useEffect(() => {
    setIndex(0);
  }, [query]);

  function go(item: Item) {
    setOpen(false);
    router.push(item.href);
  }

  function onListKey(event: React.KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((value) => (value + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((value) => (value - 1 + results.length) % results.length);
    } else if (event.key === "Enter" && results[index]) {
      event.preventDefault();
      go(results[index]);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-modal">
          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="flex items-start justify-center px-4 pt-[16vh]">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={SPRING_SOFT}
              className="panel-raised w-full max-w-lg overflow-hidden shadow-float"
            >
              <div className="flex items-center gap-3 border-b border-rule px-4">
                <span className="num text-xs text-muted">⌘K</span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onListKey}
                  placeholder="Jump to…"
                  aria-label="Search destinations"
                  className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
                />
              </div>
              <ul className="max-h-72 overflow-y-auto p-1.5">
                {results.length === 0 ? (
                  <li className="px-3 py-6 text-center text-sm text-muted">No matches</li>
                ) : (
                  results.map((item, i) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.href}>
                        <button
                          type="button"
                          onMouseEnter={() => setIndex(i)}
                          onClick={() => go(item)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors duration-120",
                            i === index ? "bg-control text-ink" : "text-muted",
                          )}
                        >
                          <Icon size={16} strokeWidth={1.7} aria-hidden className="shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          <span className="num text-xs text-muted">{item.group}</span>
                          {i === index ? (
                            <CornerDownLeft size={14} aria-hidden className="text-accent" />
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </motion.div>
          </div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
