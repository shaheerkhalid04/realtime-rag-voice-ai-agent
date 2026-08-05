"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Assistant" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/how-it-works", label: "How it works" },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <header
      className="sticky top-0 z-50 border-b border-hairline"
      style={{
        backgroundColor: "color-mix(in srgb, var(--canvas) 72%, transparent)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
      }}
    >
      <nav className="mx-auto flex h-12 max-w-5xl items-center justify-between px-5 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
        >
          <Mark />
          Attune
        </Link>

        <ul className="flex items-center gap-1 sm:gap-2">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={`rounded-full px-3 py-1.5 text-[13px] transition-colors duration-200
                    ${active ? "text-ink" : "text-muted hover:text-ink"}`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" aria-hidden>
      <defs>
        <linearGradient id="mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--glow-c)" />
          <stop offset="55%" stopColor="var(--glow-a)" />
          <stop offset="100%" stopColor="var(--glow-b)" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#mark)" strokeLinecap="round" strokeWidth="2">
        <path d="M4 10v4" />
        <path d="M8.5 6.5v11" />
        <path d="M13 3v18" opacity="0.85" />
        <path d="M17.5 7.5v9" opacity="0.7" />
        <path d="M21.5 10.5v3" opacity="0.55" />
      </g>
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="mt-24 border-t border-hairline bg-surface">
      <div className="mx-auto max-w-5xl px-5 py-10 sm:px-6">
        <p className="text-[12px] leading-relaxed text-faint">
          Attune answers only from documents you add. Speech in and out is handled by
          Vapi; retrieval runs on Pinecone and generation on Groq. Nothing is spoken
          that the retrieved passages do not support.
        </p>
      </div>
    </footer>
  );
}
