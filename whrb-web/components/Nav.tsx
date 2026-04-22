'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationBell } from '@/components/NotificationBell';
import { SignOutButton } from '@/components/SignOutButton';

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/prospects', label: 'All Prospects' },
  { href: '/my', label: 'My Clients' },
  { href: '/team', label: 'Team' },
];

export function Nav({
  isAdmin,
  userId,
  initialUnreadCount,
}: {
  isAdmin: boolean;
  userId: string;
  initialUnreadCount: number;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const tabs = isAdmin ? [...TABS, { href: '/admin/sources', label: 'Admin' }] : TABS;

  const settingsIcon = (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))]/80 backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background))]/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="WHRB Sales home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/whrb-logo.svg" alt="WHRB" className="h-7 w-auto" />
          <span className="hidden text-xs font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))] sm:inline">
            Sales
          </span>
        </Link>
        <nav className="ml-2 hidden gap-1 md:flex" aria-label="Primary">
          {tabs.map((tab) => {
            const active =
              tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                    : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <NotificationBell userId={userId} initialUnread={initialUnreadCount} />
          {/* Settings gear + Sign out are desktop-only on the nav.
              On mobile the settings link lives inside the hamburger drawer
              and sign-out is available at /settings/notifications. */}
          <Link
            href="/settings/notifications"
            aria-label="Settings"
            className="hidden rounded-md p-1.5 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] md:inline-flex"
          >
            {settingsIcon}
          </Link>
          <ThemeToggle />
          <div className="hidden md:inline-flex">
            <SignOutButton variant="nav" testId="nav-sign-out" />
          </div>
          {/* Mobile hamburger — right-aligned (after bell + theme). Opens a
              drawer with tabs + Settings link + Sign-out. */}
          <button
            type="button"
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            aria-expanded={drawerOpen}
            className="rounded-md p-1.5 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] md:hidden"
            data-testid="nav-hamburger"
          >
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              {drawerOpen ? (
                <>
                  <path d="M6 6l12 12" />
                  <path d="M6 18L18 6" />
                </>
              ) : (
                <>
                  <path d="M4 6h16" />
                  <path d="M4 12h16" />
                  <path d="M4 18h16" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>
      {drawerOpen ? (
        <nav
          aria-label="Mobile navigation"
          className="border-t border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))] md:hidden"
          data-testid="nav-mobile-drawer"
        >
          <ul className="flex flex-col gap-1 p-2">
            {tabs.map((tab) => {
              const active =
                tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setDrawerOpen(false)}
                    className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                        : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                    }`}
                  >
                    {tab.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[hsl(var(--border-subtle))] p-2">
            <Link
              href="/settings/notifications"
              onClick={() => setDrawerOpen(false)}
              data-testid="nav-mobile-settings"
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                pathname.startsWith('/settings')
                  ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                  : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
              }`}
            >
              <span className="inline-flex h-4 w-4 items-center justify-center">
                {settingsIcon}
              </span>
              <span>Settings</span>
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
