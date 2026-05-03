'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Calendar,
  ChevronDown,
  DollarSign,
  FileText,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  UserCircle2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { NotificationBell } from '@/components/NotificationBell';
import { SignOutButton } from '@/components/SignOutButton';
import { Logo } from '@/components/Logo';
import { useSignOut } from '@/lib/hooks/use-sign-out';
import { cn } from '@/lib/utils';

type Tab = { href: string; label: string; icon: LucideIcon };
type ThemeOpt = 'system' | 'light' | 'dark';

// Primary tabs shown inline. Lower-frequency reference content (Media Kit,
// Guide) lives under the Resources dropdown alongside the inline tabs to
// keep the bar readable.
const TABS: Tab[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/prospects', label: 'All Prospects', icon: LayoutGrid },
  { href: '/my', label: 'My Clients', icon: UserCircle2 },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/ad-orders', label: 'Ad Orders', icon: DollarSign },
  { href: '/schedule', label: 'Schedule', icon: Calendar },
];

const RESOURCES: Tab[] = [
  { href: '/media-kit', label: 'Media Kit', icon: FileText },
  { href: '/guide', label: 'Guide', icon: BookOpen },
];

const THEME_OPTIONS: { value: ThemeOpt; label: string; Icon: LucideIcon }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

// next-themes resolves the persisted theme on the client only; gate on a
// mount flag so the first render returns 'system' and avoids an
// SSR-vs-hydration flash in the radio group / aria-pressed buttons.
function useResolvedTheme(): { current: ThemeOpt; setTheme: (v: string) => void } {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current: ThemeOpt =
    (mounted ? (theme as ThemeOpt | undefined) : 'system') ?? 'system';
  return { current, setTheme };
}

/**
 * Theme picker as flat radio items, embedded directly inside the avatar
 * DropdownMenu. Replaces the legacy ThemeToggle's nested-dropdown trigger
 * — one click depth instead of two, and no hover-intent submenu.
 */
function ThemeRadioItems() {
  const { current, setTheme } = useResolvedTheme();
  return (
    <DropdownMenuRadioGroup value={current} onValueChange={setTheme}>
      {THEME_OPTIONS.map(({ value, label, Icon }) => (
        <DropdownMenuRadioItem
          key={value}
          value={value}
          data-testid={`theme-option-${value}`}
          className="cursor-pointer gap-2"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

export function Nav({
  isAdmin,
  userId,
  userEmail,
  initialUnread,
}: {
  isAdmin: boolean;
  userId: string;
  userEmail: string;
  initialUnread: number;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { current: currentTheme, setTheme } = useResolvedTheme();
  const { signOut, pending: signOutPending } = useSignOut();

  const tabs: Tab[] = isAdmin
    ? [...TABS, { href: '/admin/sources', label: 'Admin', icon: ShieldCheck }]
    : TABS;

  const resourcesActive = RESOURCES.some((r) => pathname.startsWith(r.href));

  // Shared classes for desktop tab Links and the Resources trigger so both
  // participate in the same framer-motion shared-layout pill animation.
  const tabClasses = (active: boolean) =>
    cn(
      'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'text-[hsl(var(--primary))]'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    );

  return (
    <header className="sticky top-0 z-40 border-b border-[hsl(var(--border-subtle))] bg-[hsl(var(--background))]/80 backdrop-blur-md supports-[backdrop-filter]:bg-[hsl(var(--background))]/70">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="WHRB Sales home">
          <Logo />
          <span className="hidden text-xs font-medium uppercase tracking-widest text-muted-foreground sm:inline">
            Sales
          </span>
        </Link>
        <nav className="ml-2 hidden gap-1 md:flex" aria-label="Primary">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active =
              tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={tabClasses(active)}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Resources menu"
                aria-current={resourcesActive ? 'page' : undefined}
                data-testid="nav-resources-trigger"
                className={tabClasses(resourcesActive)}
              >
                {resourcesActive ? (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 -z-10 rounded-md bg-[hsl(var(--primary-soft))]"
                    transition={{ type: 'spring', duration: 0.35, bounce: 0.2 }}
                  />
                ) : null}
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                <span>Resources</span>
                <ChevronDown className="h-3 w-3 opacity-70" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              {RESOURCES.map((r) => {
                const Icon = r.icon;
                const active = pathname.startsWith(r.href);
                return (
                  <DropdownMenuItem
                    key={r.href}
                    asChild
                    className={cn(
                      'cursor-pointer gap-2',
                      active &&
                        'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] focus:bg-[hsl(var(--primary-soft))] focus:text-[hsl(var(--primary))]',
                    )}
                  >
                    <Link href={r.href} aria-current={active ? 'page' : undefined}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{r.label}</span>
                    </Link>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <NotificationBell userId={userId} initialUnread={initialUnread} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Account menu"
                data-testid="nav-avatar-trigger"
                className="hidden md:inline-flex"
              >
                <UserCircle2 />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
                {userEmail ? `Signed in as ${userEmail}` : 'Account'}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild className="cursor-pointer gap-2">
                <Link href="/settings/notifications">
                  <SettingsIcon className="h-4 w-4" aria-hidden="true" />
                  <span>Settings</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs">Theme</DropdownMenuLabel>
              <ThemeRadioItems />
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={(e) => {
                  // Keep the menu open while the async sign-out resolves so
                  // the "Signing out…" label is visible. router.push will
                  // unmount the layout shortly after.
                  e.preventDefault();
                  void signOut();
                }}
                disabled={signOutPending}
                data-testid="nav-sign-out"
                className="cursor-pointer gap-2 text-destructive focus:text-destructive"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span>{signOutPending ? 'Signing out…' : 'Sign out'}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Toggle navigation menu"
                aria-expanded={drawerOpen}
                className="md:hidden"
                data-testid="nav-hamburger"
              >
                {drawerOpen ? <X /> : <Menu />}
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[300px] sm:w-[380px]"
              data-testid="nav-mobile-drawer"
            >
              <SheetHeader>
                <SheetTitle>Menu</SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile navigation" className="mt-4">
                <ul className="flex flex-col gap-1">
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
                              ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
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
                <p className="mt-3 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Resources
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {RESOURCES.map((r) => {
                    const Icon = r.icon;
                    const active = pathname.startsWith(r.href);
                    return (
                      <li key={r.href}>
                        <Link
                          href={r.href}
                          aria-current={active ? 'page' : undefined}
                          onClick={() => setDrawerOpen(false)}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                            active
                              ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          <span>{r.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                <Separator className="my-3" />
                <Link
                  href="/settings/notifications"
                  onClick={() => setDrawerOpen(false)}
                  data-testid="nav-mobile-settings"
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    pathname.startsWith('/settings')
                      ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                      : 'text-foreground hover:bg-muted',
                  )}
                >
                  <SettingsIcon className="h-4 w-4" aria-hidden="true" />
                  <span>Settings</span>
                </Link>
                <p className="mt-3 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Theme
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {THEME_OPTIONS.map(({ value, label, Icon }) => {
                    const active = currentTheme === value;
                    return (
                      <li key={value}>
                        <button
                          type="button"
                          onClick={() => setTheme(value)}
                          data-testid={`theme-option-${value}`}
                          aria-pressed={active}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                            active
                              ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                              : 'text-foreground hover:bg-muted',
                          )}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          <span>{label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-3 px-3">
                  <SignOutButton variant="drawer" testId="nav-sign-out" />
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
