'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Home,
  Users,
  UserCircle2,
  ShieldCheck,
  Settings,
  Menu,
  X,
  LayoutGrid,
} from 'lucide-react';

import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationBell } from '@/components/NotificationBell';
import { SignOutButton } from '@/components/SignOutButton';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

const TABS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/prospects', label: 'All Prospects', icon: LayoutGrid },
  { href: '/my', label: 'My Clients', icon: UserCircle2 },
  { href: '/team', label: 'Team', icon: Users },
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
  const tabs = isAdmin
    ? [...TABS, { href: '/admin/sources', label: 'Admin', icon: ShieldCheck }]
    : TABS;

  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2"
          aria-label="WHRB Sales home"
        >
          <Logo />
          <span className="hidden text-xs font-medium uppercase tracking-widest text-muted-foreground sm:inline">
            Sales
          </span>
        </Link>
        <nav className="ml-2 hidden gap-1 md:flex" aria-label="Primary">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active =
              tab.href === '/'
                ? pathname === '/'
                : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 -z-10 rounded-md bg-[hsl(var(--primary-soft))]"
                    transition={{ type: 'spring', duration: 0.35, bounce: 0.2 }}
                  />
                ) : null}
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{tab.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <NotificationBell userId={userId} initialUnread={initialUnreadCount} />
          {/* Settings gear + Sign out are desktop-only on the nav.
              On mobile the settings link lives inside the hamburger drawer
              and sign-out is available at /settings/notifications. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings/notifications"
                aria-label="Settings"
                className="hidden rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
              >
                <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
              </Link>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
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
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:hidden"
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
          className="border-t border-border-subtle bg-background md:hidden"
          data-testid="nav-mobile-drawer"
        >
          <ul className="flex flex-col gap-1 p-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const active =
                tab.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(tab.href);
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setDrawerOpen(false)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-[hsl(var(--primary-soft))] text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{tab.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border-subtle p-2">
            <Link
              href="/settings/notifications"
              onClick={() => setDrawerOpen(false)}
              data-testid="nav-mobile-settings"
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                pathname.startsWith('/settings')
                  ? 'bg-[hsl(var(--primary-soft))] text-primary'
                  : 'text-foreground hover:bg-muted',
              )}
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
