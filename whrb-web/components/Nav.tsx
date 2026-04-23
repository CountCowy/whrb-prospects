'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { Menu, Settings, X } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationBell } from '@/components/NotificationBell';
import { SignOutButton } from '@/components/SignOutButton';
import { Logo } from '@/components/Logo';

const TABS = [
  { href: '/', label: 'Home' },
  { href: '/prospects', label: 'All Prospects' },
  { href: '/media-kit', label: 'Media Kit' },
  { href: '/guide', label: 'Guide' },
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

  return (
    <header className="sticky top-0 z-40 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))]/85 backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background))]/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="WHRB Sales home">
          <Logo />
          <span className="hidden text-xs font-medium tracking-[0.18em] text-[hsl(var(--muted-foreground))] uppercase sm:inline">
            Sales
          </span>
        </Link>
        <nav className="ml-2 hidden gap-0.5 md:flex" aria-label="Primary">
          {tabs.map((tab) => {
            const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] after:absolute after:inset-x-3 after:-bottom-[13px] after:h-[2px] after:rounded-full after:bg-[hsl(var(--primary))]'
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
            <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
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
            {drawerOpen ? (
              <X className="h-[22px] w-[22px]" aria-hidden="true" />
            ) : (
              <Menu className="h-[22px] w-[22px]" aria-hidden="true" />
            )}
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
              const active = tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
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
              <Settings className="h-4 w-4" aria-hidden="true" />
              <span>Settings</span>
            </Link>
          </div>
        </nav>
      ) : null}
    </header>
  );
}
