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

import { LogoMark } from "@/components/LogoMark";
import { Badge } from "@/components/ui/Badge";
import { api, API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import { APP_VERSION, DEMO_MERCHANT_NAME } from "@/lib/constants";
import { usePolledQuery, type PolledQuery } from "@/lib/hooks/usePolledQuery";
import type { HealthResponse } from "@/lib/types";
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
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
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
      title: "LiveGateway selected. Real PayPal credentials are in use.",
    };
  }
  if (gateway === "simulator") {
    return {
      label: "SIMULATOR",
      tone: "amber",
      title: "SimulatorGateway — the same code path the E2E tests use. No PayPal credentials required.",
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
      title: `${API_BASE_URL} · v${health.data.version} · ${health.data.database}`,
    };
  }
  if (health.error) {
    return {
      label: "API offline",
      tone: "rose",
      live: false,
      title: `${health.error.code}: ${health.error.message}${health.error.requestId ? ` · req ${health.error.requestId}` : ""}`,
    };
  }
  return {
    label: "Connecting",
    tone: "amber",
    live: false,
    title: `Waiting for the API at ${API_BASE_URL}`,
  };
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] border border-emerald/25 bg-emerald/10">
        <LogoMark size={15} className="text-emerald" />
      </span>
      <span className={cn("leading-none", compact && "hidden sm:block")}>
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

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-[232px] flex-col border-r border-hairline bg-chrome lg:flex">
      <div className="flex h-14 items-center border-b border-hairline px-4">
        <Link href="/" className="rounded-md" aria-label="VerdictPay home">
          <BrandMark />
        </Link>
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-4">
            <div className="px-2.5 pb-1.5 kicker">{section.label}</div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12.5px] transition-colors",
                        active
                          ? "bg-white/[0.05] text-ink"
                          : "text-muted hover:bg-white/[0.03] hover:text-ink",
                      )}
                    >
                      {active ? (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-emerald"
                        />
                      ) : null}
                      <Icon
                        size={14}
                        strokeWidth={1.75}
                        aria-hidden
                        className={active ? "text-emerald" : "text-dim"}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-2.5 border-t border-hairline p-3">
        <div className="rounded-md border border-hairline bg-white/[0.02] p-2.5">
          <div className="flex items-center gap-1.5 text-[9.5px] font-medium uppercase tracking-[0.14em] text-dim">
            <Link2 size={11} aria-hidden />
            System of record
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-ink">SHA-256 · per payer</div>
          <div className="mt-0.5 text-[10.5px] text-muted">Append-only hash chain</div>
        </div>
        <div className="flex items-center gap-1.5 px-0.5 text-[10.5px] text-muted">
          <KeyRound size={11} aria-hidden />
          X-API-Key loaded
        </div>
        <div className="flex items-center justify-between px-0.5 font-mono text-[10px] text-dim">
          <span>v{APP_VERSION}</span>
          <span>MIT</span>
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
            <BrandMark compact />
          </Link>
          <div className="hidden items-center gap-2 text-[12px] lg:flex">
            <span className="text-muted">Merchant</span>
            <span className="text-ink">{DEMO_MERCHANT_NAME}</span>
            <span className="text-dim">/</span>
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
              "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.06em]",
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
          <span className="hidden font-mono text-[10.5px] text-dim md:inline">
            v{health.data?.version ?? APP_VERSION}
          </span>
        </div>
      </div>

      <nav
        aria-label="Primary mobile"
        className="flex gap-1 overflow-x-auto border-t border-hairline px-2 py-1.5 lg:hidden"
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
                "flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-[11.5px]",
                active
                  ? "bg-white/[0.06] text-ink"
                  : "text-muted hover:bg-white/[0.03] hover:text-ink",
              )}
            >
              <Icon
                size={12}
                aria-hidden
                className={active ? "text-emerald" : "text-dim"}
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

  return (
    <div className="relative min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:border focus:border-hairline focus:bg-panel focus:px-3 focus:py-2 focus:text-ink"
      >
        Skip to content
      </a>
      <Sidebar pathname={pathname} />
      <div className="relative z-10 lg:pl-[232px]">
        <TopBar pathname={pathname} health={health} />
        <main
          id="main"
          className="mx-auto w-full max-w-[1560px] px-3 pb-16 pt-5 sm:px-5 lg:px-7"
        >
          {children}
        </main>
      </div>
      <span className="sr-only" aria-live="polite">
        {health.error ? `API error ${health.error.code}` : ""}
      </span>
    </div>
  );
}