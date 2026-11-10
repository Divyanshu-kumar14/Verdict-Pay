"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { motion } from "motion/react";
import {
  BarChart3,
  CalendarClock,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Scale,
  Search,
  Settings,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import { CommandPalette } from "@/components/chrome/CommandPalette";
import { Badge } from "@/components/ui/Badge";
import { api, API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { APP_VERSION, DEMO_MERCHANT_NAME } from "@/lib/constants";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery, type PolledQuery } from "@/lib/hooks/usePolledQuery";
import { SPRING } from "@/lib/motion";
import type { DisputePage, HealthResponse } from "@/lib/types";
import { type Tone } from "@/lib/vocab";

/* short is the bottom-bar word: five cells at 390px are 78px wide, so a longer
   label overflows its cell and lands on the screen edge. */
type NavItem = {
  href: string;
  label: string;
  short: string;
  icon: LucideIcon;
  exact?: boolean;
};

/* Six destinations, so the rail needs no words when collapsed. */
const NAV: NavItem[] = [
  { href: "/demo", label: "Live demo", short: "Demo", icon: Play, exact: true },
  { href: "/disputes", label: "Disputes", short: "Disputes", icon: Scale },
  { href: "/timeline", label: "SLA board", short: "SLA", icon: CalendarClock },
  { href: "/analytics", label: "Analytics", short: "Analytics", icon: BarChart3 },
  { href: "/veto-lab", label: "Veto Lab", short: "Veto", icon: ShieldAlert },
  { href: "/settings", label: "Connection", short: "Settings", icon: Settings },
];

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 72;

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function sectionName(pathname: string): string {
  if (pathname.startsWith("/disputes/")) return "Case";
  if (pathname.startsWith("/disputes")) return "Disputes";
  if (pathname.startsWith("/timeline")) return "SLA board";
  if (pathname.startsWith("/analytics")) return "Analytics";
  if (pathname.startsWith("/veto-lab")) return "Veto Lab";
  if (pathname.startsWith("/settings")) return "Connection";
  return "Dashboard";
}

function connectionMeta(health: PolledQuery<HealthResponse>): {
  label: string;
  tone: Tone;
  live: boolean;
  title: string;
} {
  if (health.data?.status === "ok") {
    return {
      label: "Connected",
      tone: "positive",
      live: true,
      title: API_BASE_URL + " · v" + health.data.version + " · " + health.data.database,
    };
  }
  if (health.error) {
    // Still holding the last good response? Then we're reconnecting, not offline.
    if (health.data !== null) {
      return {
        label: "Reconnecting",
        tone: "warning",
        live: false,
        title: health.error.code + ": " + health.error.message + " — showing last known data",
      };
    }
    return {
      label: "Offline",
      tone: "negative",
      live: false,
      title: health.error.code + ": " + health.error.message,
    };
  }
  return { label: "Connecting", tone: "accent", live: false, title: "Waiting for " + API_BASE_URL };
}

function gatewayMeta(health: PolledQuery<HealthResponse>): {
  label: string;
  tone: Tone;
  title: string;
} {
  const status = health.data?.gateway_status;
  if (!status) {
    return { label: "Gateway", tone: "accent", title: "Waiting for /health" };
  }
  if (status.readiness !== "ready") {
    return {
      label: "PayPal unconfigured",
      tone: "negative",
      title: status.blockers.join("; ") || "PayPal credentials are missing.",
    };
  }
  if (status.live) {
    return { label: "Live PayPal", tone: "negative", title: "PAYPAL_LIVE: real money moves." };
  }
  return {
    label: "PayPal Sandbox",
    tone: "accent",
    title: "PAYPAL_SANDBOX at " + status.api_base + ". Test funds only.",
  };
}

/** Seconds since the last successful refresh, rendered as a live "Updated …". */
function useLastRefresh(updatedAt: number | null): string {
  const now = useNow(10000);
  if (updatedAt === null) return "No live data yet";
  if (now === null) return "Refreshed";
  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000));
  if (seconds < 5) return "Refreshed just now";
  if (seconds < 60) return "Refreshed " + seconds + "s ago";
  return "Refreshed " + Math.round(seconds / 60) + "m ago";
}

/** True once a request has been in flight (with no data yet) for >3s — the
 *  server is cold-starting, not hung. Drives the "waking the server" notice. */
function useWaking(loading: boolean): boolean {
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    if (!loading) {
      setWaking(false);
      return;
    }
    const timer = setTimeout(() => setWaking(true), 3000);
    return () => clearTimeout(timer);
  }, [loading]);
  return waking;
}

function Rail({
  pathname,
  health,
  cases,
  collapsed,
  onToggle,
}: {
  pathname: string;
  health: PolledQuery<HealthResponse>;
  cases: PolledQuery<DisputePage>;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const connection = connectionMeta(health);
  const caseTotal = cases.data?.meta.total ?? null;

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-line bg-surface lg:flex",
        "transition-[width] duration-200 ease-snap",
      )}
      style={{ width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED }}
    >
      <Link
        href="/"
        aria-label="VerdictPay home"
        className="flex h-14 w-full shrink-0 items-center gap-2.5 overflow-hidden px-4 text-ink"
      >
        <LogoMark size={20} className="shrink-0 text-accent" />
        {collapsed ? null : (
          <span className="truncate text-sm font-semibold tracking-tight">VerdictPay</span>
        )}
      </Link>

      <nav aria-label="Primary" className="flex flex-col gap-0.5 px-2.5 py-1.5">
        {NAV.map(function (item, index) {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          const count = item.href === "/disputes" ? caseTotal : null;
          return (
            <span key={item.href} className="contents">
              {index === 4 ? <span aria-hidden className="my-2 h-px bg-rule" /> : null}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex h-10 items-center overflow-visible rounded-md text-sm font-medium transition-colors duration-120",
                  collapsed ? "justify-center px-0" : "gap-3 pl-3 pr-2",
                  active ? "text-ink" : "text-muted hover:text-ink",
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="nav-active"
                    aria-hidden
                    className="absolute inset-0 rounded-md bg-raised"
                    transition={SPRING}
                  />
                ) : null}
                {active ? (
                  <motion.span
                    layoutId="nav-indicator"
                    aria-hidden
                    className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-accent"
                    transition={SPRING}
                  />
                ) : null}
                <Icon size={17} strokeWidth={1.7} aria-hidden className="relative z-10 shrink-0" />
                {!collapsed ? <span className="relative z-10 truncate">{item.label}</span> : null}
                {count !== null ? (
                  <span
                    className={cn(
                      "num relative z-10 rounded-full bg-control px-1.5 text-2xs font-medium text-muted",
                      collapsed ? "absolute right-1.5 top-1" : "ml-auto",
                    )}
                  >
                    {count}
                  </span>
                ) : null}
                {collapsed ? (
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute left-full top-1/2 z-toast ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink opacity-0 shadow-float transition-opacity duration-120 group-hover:opacity-100"
                  >
                    {item.label}
                  </span>
                ) : null}
              </Link>
            </span>
          );
        })}
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="mx-2.5 mb-2.5 flex h-9 items-center gap-2.5 overflow-hidden rounded-md px-2.5 text-muted transition-colors duration-120 hover:bg-raised hover:text-ink"
      >
        {collapsed ? (
          <PanelLeftOpen size={16} strokeWidth={1.7} className="shrink-0" />
        ) : (
          <PanelLeftClose size={16} strokeWidth={1.7} className="shrink-0" />
        )}
        {collapsed ? null : <span className="text-xs font-medium">Collapse</span>}
      </button>

      <div className="flex w-full items-center gap-2.5 overflow-hidden border-t border-rule px-4 py-3">
        <span title={connection.title} role="status" aria-label={connection.label}>
          <span
            aria-hidden
            className={cn(
              "block h-2 w-2 shrink-0 rounded-full",
              connection.tone === "positive" && "bg-positive",
              connection.tone === "negative" && "bg-negative",
              connection.tone === "warning" && "bg-warning",
            )}
          />
        </span>
        {collapsed ? null : <span className="truncate text-xs text-muted">{connection.label}</span>}
      </div>
    </aside>
  );
}

function TopBar({
  pathname,
  health,
}: {
  pathname: string;
  health: PolledQuery<HealthResponse>;
}) {
  const connection = connectionMeta(health);
  const gateway = gatewayMeta(health);
  const lastRefresh = useLastRefresh(health.updatedAt);
  const waking = useWaking(health.loading);

  return (
    <header className="sticky top-0 z-sticky border-b border-line bg-ground/80 backdrop-blur-sm">
      <div className="flex h-14 items-center justify-between gap-3 px-5 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href="/" className="text-ink lg:hidden" aria-label="VerdictPay home">
            <LogoMark size={17} />
          </Link>
          <span className="truncate text-base font-semibold text-ink lg:hidden">VerdictPay</span>
          <span className="hidden truncate text-base text-muted lg:block">
            <span className="text-ink">{DEMO_MERCHANT_NAME}</span>
            <span aria-hidden className="px-2 text-muted">
              /
            </span>
            {sectionName(pathname)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("vp-open-palette"))}
            className="hidden h-8 items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-xs text-muted transition-colors duration-120 hover:text-ink lg:flex"
            aria-label="Open command palette"
          >
            <Search size={13} aria-hidden />
            <span>Search</span>
            <kbd className="num rounded border border-line bg-raised px-1 text-2xs">⌘K</kbd>
          </button>
          {waking ? (
            <span className="num hidden items-center gap-1.5 text-xs text-warning md:flex" role="status">
              Waking the server — first load can take ~30s
            </span>
          ) : (
            <span
              className="num hidden items-center gap-1.5 text-xs text-muted md:flex"
              title="Time since the last successful API refresh"
            >
              {lastRefresh}
            </span>
          )}
          <Badge tone={connection.tone} dot title={connection.title}>
            {connection.label}
          </Badge>
          <Badge tone={gateway.tone} title={gateway.title} className="hidden sm:inline-flex">
            {gateway.label}
          </Badge>
          <span className="num hidden text-xs text-muted lg:inline">
            v{health.data?.version ?? APP_VERSION}
          </span>
        </div>
      </div>
    </header>
  );
}

/* A phone keeps the same five destinations as a bottom bar, each with a word. */
function PhoneBar({ pathname, cases }: { pathname: string; cases: PolledQuery<DisputePage> }) {
  const caseTotal = cases.data?.meta.total ?? null;
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-sticky flex border-t border-line bg-surface lg:hidden"
    >
      {NAV.map(function (item) {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        const count = item.href === "/disputes" ? caseTotal : null;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-2xs",
              active ? "text-accent" : "text-muted",
            )}
          >
            {active ? (
              <motion.span
                layoutId="phone-active"
                aria-hidden
                className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-accent"
                transition={SPRING}
              />
            ) : null}
            <Icon size={17} strokeWidth={1.7} aria-hidden />
            <span className="max-w-full px-1 truncate">{item.short}</span>
            {count !== null ? (
              <span
                aria-hidden
                className="absolute right-[calc(50%-22px)] top-0.5 h-1.5 w-1.5 rounded-full bg-accent"
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** The persistent control room: an expandable nav, a live header and the page canvas. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const health = usePolledQuery("shell:health", function (signal) {
    return api.health(signal);
  }, { intervalMs: 20000 });
  const cases = usePolledQuery("shell:cases", function (signal) {
    return api.listDisputes({ page: 1, perPage: 1 }, signal);
  }, { intervalMs: 20000 });

  useEffect(() => {
    try {
      if (window.localStorage.getItem("vp.shell.collapsed") === "1") setCollapsed(true);
    } catch {
      /* storage unavailable — default to expanded */
    }
  }, []);

  const toggle = (): void => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem("vp.shell.collapsed", next ? "1" : "0");
      } catch {
        /* storage may be unavailable; the toggle still works in-memory */
      }
      return next;
    });
  };

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-modal focus:rounded-full focus:bg-raised focus:px-4 focus:py-2 focus:text-sm focus:text-ink"
      >
        Skip to content
      </a>
      <Rail pathname={pathname} health={health} cases={cases} collapsed={collapsed} onToggle={toggle} />
      <div
        className={cn(
          "transition-[padding] duration-200 ease-snap",
          collapsed ? "lg:pl-[72px]" : "lg:pl-[240px]",
        )}
      >
        <TopBar pathname={pathname} health={health} />
        <main
          id="main"
          className="mx-auto w-full max-w-[1760px] px-5 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12"
        >
          {children}
        </main>
      </div>
      <PhoneBar pathname={pathname} cases={cases} />
      <CommandPalette />
      <span className="sr-only" aria-live="polite">
        {health.error ? "API error " + health.error.code : ""}
      </span>
    </div>
  );
}
