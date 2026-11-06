"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BarChart3,
  CalendarClock,
  Play,
  Scale,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { LogoMark } from "@/components/LogoMark";
import { Badge } from "@/components/ui/Badge";
import { api, API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { APP_VERSION, DEMO_MERCHANT_NAME } from "@/lib/constants";
import { usePolledQuery, type PolledQuery } from "@/lib/hooks/usePolledQuery";
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

/* Five destinations, so the rail needs no words. Groups are split by a rule. */
const NAV: NavItem[] = [
  { href: "/", label: "Command centre", short: "Home", icon: Play, exact: true },
  { href: "/disputes", label: "Disputes", short: "Disputes", icon: Scale },
  { href: "/timeline", label: "SLA board", short: "SLA", icon: CalendarClock },
  { href: "/analytics", label: "Analytics", short: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Connection", short: "Settings", icon: Settings },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function sectionName(pathname: string): string {
  if (pathname === "/") return "Command centre";
  if (pathname.startsWith("/disputes/")) return "Case";
  if (pathname.startsWith("/disputes")) return "Disputes";
  if (pathname.startsWith("/timeline")) return "SLA board";
  if (pathname.startsWith("/analytics")) return "Analytics";
  if (pathname.startsWith("/settings")) return "Connection";
  return "Command centre";
}

function connectionMeta(health: PolledQuery<HealthResponse>): {
  label: string;
  tone: Tone;
  live: boolean;
  title: string;
} {
  if (health.data?.status === "ok") {
    return {
      label: "API live",
      tone: "positive",
      live: true,
      title: API_BASE_URL + " · v" + health.data.version + " · " + health.data.database,
    };
  }
  if (health.error) {
    return {
      label: "API offline",
      tone: "negative",
      live: false,
      title: health.error.code + ": " + health.error.message,
    };
  }
  return { label: "Connecting", tone: "warning", live: false, title: "Waiting for " + API_BASE_URL };
}

function gatewayMeta(health: PolledQuery<HealthResponse>): {
  label: string;
  tone: Tone;
  title: string;
} {
  const gateway = health.data?.gateway ?? health.data?.mode;
  if (gateway === "live") {
    return { label: "Live PayPal", tone: "negative", title: "Real PayPal credentials are in use." };
  }
  return {
    label: "Simulator",
    tone: "accent",
    title: "Deterministic simulator. No PayPal credentials required.",
  };
}

function Rail({
  pathname,
  health,
  cases,
}: {
  pathname: string;
  health: PolledQuery<HealthResponse>;
  cases: PolledQuery<DisputePage>;
}) {
  const connection = connectionMeta(health);
  const caseTotal = cases.data?.meta.total ?? null;

  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-rail flex-col items-center bg-surface lg:flex">
      <span aria-hidden className="absolute inset-y-0 right-0 w-px bg-line" />
      <Link
        href="/"
        aria-label="VerdictPay home"
        className="grid h-14 w-full shrink-0 place-items-center text-ink"
      >
        <LogoMark size={18} />
      </Link>

      <nav aria-label="Primary" className="flex w-full flex-col items-center gap-0.5 py-1">
        {NAV.map(function (item, index) {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          const count = item.href === "/disputes" ? caseTotal : null;
          return (
            <span key={item.href} className="contents">
              {index === 4 ? (
                <span aria-hidden className="my-2 h-px w-5 bg-rule" />
              ) : null}
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={item.label}
                className={cn(
                  "relative grid h-10 w-10 place-items-center rounded-card transition-colors duration-120",
                  active ? "bg-raised text-ink" : "text-muted hover:bg-raised hover:text-ink",
                )}
              >
                {active ? (
                  <span aria-hidden className="sig-edge absolute -right-[7px] inset-y-2" />
                ) : null}
                <Icon size={17} strokeWidth={1.6} aria-hidden />
                <span className="sr-only">{item.label}</span>
                {count !== null ? (
                  <span className="num absolute -top-0.5 -right-0.5 rounded-full bg-raised px-1 text-2xs font-medium text-muted">
                    {count}
                  </span>
                ) : null}
              </Link>
            </span>
          );
        })}
      </nav>

      <div className="flex-1" />

      <div className="flex w-full flex-col items-center gap-2 pb-4">
        <span
          title={connection.title}
          className="grid h-8 w-8 place-items-center"
          role="status"
          aria-label={connection.label}
        >
          <span
            aria-hidden
            className={cn(
              "h-2 w-2 rounded-full",
              connection.tone === "positive" && "bg-positive",
              connection.tone === "negative" && "bg-negative",
              connection.tone === "warning" && "bg-warning",
              connection.live && "live-dot",
            )}
          />
        </span>
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

  return (
    <header className="sticky top-0 z-sticky border-b border-line bg-ground">
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
          <Badge tone={connection.tone} dot title={connection.title}>
            {connection.label}
          </Badge>
          <Badge tone={gateway.tone} title={gateway.title} className="hidden sm:inline-flex">
            {gateway.label}
          </Badge>
          <span className="num hidden text-xs text-muted md:inline">
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
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center gap-1 py-2 text-2xs",
              active ? "text-ink" : "text-muted",
            )}
          >
            {active ? <span aria-hidden className="sig absolute inset-x-4 top-0" /> : null}
            <Icon size={17} strokeWidth={1.6} aria-hidden />
            <span className="max-w-full px-1 truncate">{item.short}</span>
            {item.href === "/disputes" && caseTotal !== null ? (
              <span className="sr-only">{caseTotal} open cases</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** The persistent control room: a 55px rail, a live header and the page canvas. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const health = usePolledQuery("shell:health", function (signal) {
    return api.health(signal);
  }, { intervalMs: 20000 });
  const cases = usePolledQuery("shell:cases", function (signal) {
    return api.listDisputes({ page: 1, perPage: 1 }, signal);
  }, { intervalMs: 20000 });

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-4 focus:z-modal focus:rounded-full focus:bg-raised focus:px-4 focus:py-2 focus:text-sm focus:text-ink"
      >
        Skip to content
      </a>
      <Rail pathname={pathname} health={health} cases={cases} />
      <div className="lg:pl-rail">
        <TopBar pathname={pathname} health={health} />
        <main
          id="main"
          className="mx-auto w-full max-w-[1760px] px-5 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-12"
        >
          {children}
        </main>
      </div>
      <PhoneBar pathname={pathname} cases={cases} />
      <span className="sr-only" aria-live="polite">
        {health.error ? "API error " + health.error.code : ""}
      </span>
    </div>
  );
}
