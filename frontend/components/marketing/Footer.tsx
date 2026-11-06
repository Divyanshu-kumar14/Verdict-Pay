import Link from "next/link";

import { LogoMark } from "@/components/LogoMark";

export function Footer() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2.5">
          <LogoMark size={18} className="text-accent" />
          <div>
            <p className="text-sm font-semibold text-ink">VerdictPay</p>
            <p className="font-mono text-2xs text-muted">© 2026 VerdictPay · Privacy · Terms</p>
          </div>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Link href="/settings" className="text-muted transition-colors duration-150 hover:text-ink">
            System status
          </Link>
          <a href="https://github.com/Divyanshu-kumar14/Verdict-Pay" target="_blank" rel="noreferrer" className="text-muted transition-colors duration-150 hover:text-ink">
            GitHub
          </a>
          <Link href="/demo" className="text-muted transition-colors duration-150 hover:text-ink">
            Live demo
          </Link>
        </nav>
      </div>
    </footer>
  );
}
