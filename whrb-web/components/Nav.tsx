'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  BookOpen,
  FileText,
  Home,
  LayoutGrid,
  Menu,
  Settings as SettingsIcon,
  ShieldCheck,
  UserCircle2,
  Users,
  type LucideIcon,
} from 'lucide-react';
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

type Tab = { href: string; label: string; icon: LucideIcon };

const TABS: Tab[] = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/prospects', label: 'All Prospects', icon: LayoutGrid },
  { href: '/media-kit', label: 'Media Kit', icon: FileText },
  { href: '/guide', label: 'Guide', icon: BookOpen },
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
  const tabs: Tab[] = isAdmin
    ? [...TABS, { href: '/admin/sources', label: 'Admin', icon: ShieldCheck }]
    : TABS;

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
                className={cn(
                  'relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  active
                    ? 'text-[hsl(var(--primary))]'
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
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
