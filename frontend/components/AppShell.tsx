"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  BarChart3,
  CalendarClock,
  KeyRound,
  Link2,
  Play,
  Scale,
  Settings,
  type LucideIcon,
} from "lucide-react";

import { StatusCluster } from "@/components/chrome/StatusCluster";
import { LogoMark } from "@/components/LogoMark";
import { FieldLabel } from "@/components/premium/FieldLabel";
import { Badge } from "@/components/ui/Badge";
import { api, API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { APP_VERSION, DEMO_MERCHANT_NAME } from "@/lib/constants";
import { usePolledQuery, type PolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputePage, HealthResponse } from "@/lib/types";
import { TONE_BADGE, TONE_DOT, type Tone } from "@/lib/vocab";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Command",
    items: [
      { href: "/", label: "Judge sandbox", icon: Play, exact: true },
      { href: "/disputes", label: "Disputes", icon: Scale },
      { href: "/timeline", label: "SLA board", icon: CalendarClock },
    ],
  },
  {
    label: "Intelligence",
    items: [{ href: "/analytics", label: "Analytics", icon: BarChart3 }],
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Connection", icon: Settings }],
  },
];

const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

function pageTitle(pathname: string): string {
  if (pathname === "/") return "Judge sandbox";
  if (pathname.startsWith("/disputes/")) return "Case room";
  if (pathname.startsWith("/disputes")) return "Triage queue";
  if (pathname.startsWith("/timeline")) return "SLA command board";
  if (pathname.startsWith("/analytics")) return "Exposure canvas";
  if (pathname.startsWith("/settings")) return "Connection";
  return "Command center";
}

function gatewayLabel(health: PolledQuery<HealthResponse>): { label: string; tone: Tone; title: string } {
  const gateway = health.data?.gateway ?? health.data?.mode;
  if (gateway === "live") {
    return {
      label: "LIVE",
      tone: "rose",
      title: "Live gateway selected. Real PayPal credentials are in use.",
    };
  }
  if (gateway === "simulator") {
    return {
      label: "SIMULATOR",
      tone: "amber",
      title: "Simulator gateway - the same code path the E2E tests use. No PayPal credentials required.",
    };
  }
  return {
    label: "SIMULATOR",
    tone: "amber",
    title: "Default demo gateway is the deterministic simulator; no PayPal credentials required.",
  };
}

function connectionStatus(health: PolledQuery<HealthResponse>): {
  label: string;
  tone: Tone;
  live: boolean;
  title: string;
} {
  if (health.data?.status === "ok") {
    return {
      label: "API live",
      tone: "emerald",
      live: true,
      title: API_BASE_URL + " - v" + health.data.version + " - " + health.data.database,
    };
  }
  if (health.error) {
    return {
      label: "API offline",
      tone: "rose",
      live: false,
      title: health.error.code + ": " + health.error.message + (health.error.requestId ? " - req " + health.error.requestId : ""),
    };
  }
  return {
    label: "Connecting",
    tone: "amber",
    live: false,
    title: "Waiting for the API at " + API_BASE_URL,
  };
}

function BrandLockup() {
  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-hairline-strong bg-raised text-ice shadow-[inset_0_1px_0_0_rgba(255,255,255,0.08)]"
      >
        <LogoMark size={16} />
      </span>
      <span className="leading-none">
        <span className="block text-[13px] font-semibold tracking-[-0.01em] text-ink">
          VerdictPay
        </span>
        <span className="mt-1 block text-[9px] font-medium uppercase tracking-[0.18em] text-dim">
          Dispute operations
        </span>
      </span>
    </span>
  );
}

function Sidebar({
  pathname,
  health,
  cases,
}: {
  pathname: string;
  health: PolledQuery<HealthResponse>;
  cases: PolledQuery<DisputePage>;
}) {
  const caseTotal = cases.data?.meta.total ?? null;
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[248px] flex-col border-r border-hairline bg-chrome lg:flex">
      <span aria-hidden className="instrument-ticks h-[3px] w-full shrink-0 opacity-70" />
      <div className="flex h-16 shrink-0 items-center border-b border-hairline px-4">
        <Link href="/" className="rounded-md" aria-label="VerdictPay home">
          <BrandLockup />
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2.5 py-4">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-5 last:mb-0">
            <FieldLabel rule className="px-1 pb-2">
              {section.label}
            </FieldLabel>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                const showCount = item.href === "/disputes";
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-[6px] border py-2 pl-3 pr-2.5 text-[12.5px] transition-colors",
                        active
                          ? "border-hairline-strong bg-raised text-ink"
                          : "border-transparent text-muted hover:border-hairline hover:bg-white/[0.03] hover:text-ink",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute bottom-[7px] left-0 top-[7px] w-[2px] rounded-full bg-ice"
                        />
                      ) : null}
                      <Icon
                        size={14}
                        strokeWidth={1.75}
                        aria-hidden
                        className={active ? "text-ice" : "text-dim"}
                      />
                      <span className="truncate">{item.label}</span>
                      {showCount ? (
                        <span
                          className="tnum ml-auto shrink-0 font-mono text-[10.5px] text-dim"
                          title="Disputes in the triage queue"
                        >
                          {caseTotal ?? "--"}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 space-y-3 border-t border-hairline p-3">
        <StatusCluster health={health} cases={cases} />
        <div className="space-y-1.5 border-t border-hairline pt-2.5">
          <div className="flex items-center gap-1.5 text-[10.5px] text-muted">
            <Link2 size={11} aria-hidden className="shrink-0 text-dim" />
            <span className="tnum font-mono text-[10px]">SHA-256 chain - per payer</span>
          </div>
          <div className="flex items-center justify-between text-[10.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <KeyRound size={11} aria-hidden className="text-dim" />
              X-API-Key loaded
            </span>
            <span className="tnum font-mono text-[10px] text-dim">v{APP_VERSION}</span>
          </div>
        </div>
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
  const status = connectionStatus(health);
  const gateway = gatewayLabel(health);

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-void">
      <div className="flex h-14 items-center justify-between gap-3 px-3 sm:px-5 lg:px-7">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" className="rounded-md lg:hidden" aria-label="VerdictPay home">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] border border-hairline-strong bg-raised text-ice"
              >
                <LogoMark size={14} />
              </span>
              <span className="hidden text-[13px] font-semibold tracking-[-0.01em] text-ink sm:block">
                VerdictPay
              </span>
            </span>
          </Link>
          <div className="hidden items-center gap-2 text-[12px] lg:flex">
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-dim">Merchant</span>
            <span className="text-muted">{DEMO_MERCHANT_NAME}</span>
            <span aria-hidden className="text-dim">/</span>
            <span className="font-medium text-ink">{pageTitle(pathname)}</span>
          </div>
          <div className="truncate text-[13px] font-medium text-ink lg:hidden">
            {pageTitle(pathname)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            title={status.title}
            className={cn(
              "tnum inline-flex items-center gap-1.5 rounded-[4px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em]",
              TONE_BADGE[status.tone],
            )}
          >
            <span
              aria-hidden
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                TONE_DOT[status.tone],
                status.live && "live-dot",
              )}
            />
            {status.label}
          </span>
          <Badge tone={gateway.tone} dot title={gateway.title}>
            {gateway.label}
          </Badge>
          <span className="tnum hidden font-mono text-[10.5px] text-dim md:inline">
            v{health.data?.version ?? APP_VERSION}
          </span>
        </div>
      </div>

      <nav
        aria-label="Primary mobile"
        className="flex flex-wrap gap-1 border-t border-hairline px-2 py-1.5 lg:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[11.5px]",
                active
                  ? "border-hairline-strong bg-raised text-ink shadow-[inset_0_-2px_0_0_var(--color-ice)]"
                  : "border-transparent text-muted hover:border-hairline hover:bg-white/[0.03] hover:text-ink",
              )}
            >
              <Icon
                size={12}
                aria-hidden
                className={active ? "text-ice" : "text-dim"}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

/** The persistent control-room shell: sidebar, connection rail and page canvas. */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const health = usePolledQuery("shell:health", (signal) => api.health(signal), {
    intervalMs: 20000,
  });
  const cases = usePolledQuery(
    "shell:cases",
    (signal) => api.listDisputes({ page: 1, perPage: 1 }, signal),
    { intervalMs: 20000 },
  );

  return (
    <div className="relative min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:border focus:border-hairline focus:bg-panel focus:px-3 focus:py-2 focus:text-ink"
      >
        Skip to content
      </a>
      <Sidebar pathname={pathname} health={health} cases={cases} />
      <div className="relative z-10 lg:pl-[248px]">
        <TopBar pathname={pathname} health={health} />
        <main
          id="main"
          className="mx-auto w-full max-w-[1560px] px-3 pb-16 pt-5 sm:px-5 lg:px-7"
        >
          {children}
        </main>
      </div>
      <span className="sr-only" aria-live="polite">
        {health.error ? "API error " + health.error.code : ""}
      </span>
    </div>
  );
}
