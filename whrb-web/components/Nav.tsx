'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ThemeToggle } from '@/components/ThemeToggle';
import { NotificationBell } from '@/components/NotificationBell';
import { SignOutButton } from '@/components/SignOutButton';
import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';

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
            const active =
              tab.href === '/' ? pathname === '/' : pathname.startsWith(tab.href);
            return (
              <Button
                key={tab.href}
                asChild
                variant="ghost"
                size="sm"
                className={cn(
                  'h-8 text-sm font-medium',
                  active
                    ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-soft-hover))]'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Link
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                >
                  {tab.label}
                </Link>
              </Button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <NotificationBell userId={userId} initialUnread={initialUnreadCount} />
          <Button
            asChild
            variant="ghost"
            size="icon"
            aria-label="Settings"
            className="hidden md:inline-flex"
          >
            <Link href="/settings/notifications">
              <SettingsIcon className="h-[18px] w-[18px]" />
            </Link>
          </Button>
          <ThemeToggle />
          <div className="hidden md:inline-flex">
            <SignOutButton variant="nav" testId="nav-sign-out" />
          </div>
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Toggle navigation menu"
                className="md:hidden"
                data-testid="nav-hamburger"
              >
                <Menu className="h-[22px] w-[22px]" />
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
                    const active =
                      tab.href === '/'
                        ? pathname === '/'
                        : pathname.startsWith(tab.href);
                    return (
                      <li key={tab.href}>
                        <Button
                          asChild
                          variant="ghost"
                          className={cn(
                            'w-full justify-start text-sm font-medium',
                            active
                              ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-soft-hover))]'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          onClick={() => setDrawerOpen(false)}
                        >
                          <Link
                            href={tab.href}
                            aria-current={active ? 'page' : undefined}
                          >
                            {tab.label}
                          </Link>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <Separator className="my-3" />
                <Button
                  asChild
                  variant="ghost"
                  onClick={() => setDrawerOpen(false)}
                  data-testid="nav-mobile-settings"
                  className={cn(
                    'w-full justify-start gap-2 text-sm font-medium',
                    pathname.startsWith('/settings')
                      ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-soft-hover))]'
                      : 'text-foreground',
                  )}
                >
                  <Link href="/settings/notifications">
                    <SettingsIcon className="h-4 w-4" />
                    <span>Settings</span>
                  </Link>
                </Button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
