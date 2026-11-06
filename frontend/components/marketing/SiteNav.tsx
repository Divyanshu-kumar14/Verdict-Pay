import Link from "next/link";

import { LogoMark } from "@/components/LogoMark";

const LINKS = [
  { href: "/#product", label: "Product" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/demo", label: "Demo" },
];

/** The shared marketing header: logo, section anchors and the primary dashboard
 *  entry. The landing page and the live demo both render it, so "How it works"
 *  always resolves through the root URL regardless of which page you were on. */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-sticky border-b border-line bg-ground/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1120px] items-center gap-8 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 text-ink" aria-label="VerdictPay home">
          <LogoMark size={20} className="text-accent" />
          <span className="text-base font-semibold tracking-tight">VerdictPay</span>
        </Link>

        <nav aria-label="Site" className="hidden flex-1 items-center gap-1 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors duration-150 hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/demo"
            className="hidden text-sm font-medium text-muted transition-colors duration-150 hover:text-ink sm:block"
          >
            Run the demo
          </Link>
          <Link
            href="/disputes"
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-ground transition-transform duration-150 hover:scale-[1.02] active:scale-[0.99]"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    </header>
  );
}
