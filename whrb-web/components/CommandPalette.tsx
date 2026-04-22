'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Bell,
  Home,
  LayoutGrid,
  Monitor,
  Moon,
  Plus,
  Settings,
  ShieldCheck,
  Sun,
  UserCircle2,
  Users,
} from 'lucide-react';

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';

export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Jump to page or run a command…"
        data-testid="command-palette-input"
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem value="home" onSelect={() => go('/')}>
            <Home className="h-4 w-4" />
            <span>Home</span>
          </CommandItem>
          <CommandItem
            value="all prospects"
            onSelect={() => go('/prospects')}
          >
            <LayoutGrid className="h-4 w-4" />
            <span>All Prospects</span>
          </CommandItem>
          <CommandItem value="my clients" onSelect={() => go('/my')}>
            <UserCircle2 className="h-4 w-4" />
            <span>My Clients</span>
          </CommandItem>
          <CommandItem value="team" onSelect={() => go('/team')}>
            <Users className="h-4 w-4" />
            <span>Team</span>
          </CommandItem>
          <CommandItem
            value="notifications"
            onSelect={() => go('/notifications')}
          >
            <Bell className="h-4 w-4" />
            <span>Notifications</span>
          </CommandItem>
          <CommandItem
            value="settings"
            onSelect={() => go('/settings/notifications')}
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </CommandItem>
          {isAdmin ? (
            <CommandItem value="admin" onSelect={() => go('/admin/sources')}>
              <ShieldCheck className="h-4 w-4" />
              <span>Admin</span>
            </CommandItem>
          ) : null}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="add prospect"
            onSelect={() => go('/prospects')}
          >
            <Plus className="h-4 w-4" />
            <span>Add Prospect</span>
          </CommandItem>
          <CommandItem
            value="theme system"
            onSelect={() => {
              setTheme('system');
              setOpen(false);
            }}
          >
            <Monitor className="h-4 w-4" />
            <span>Theme: System</span>
          </CommandItem>
          <CommandItem
            value="theme light"
            onSelect={() => {
              setTheme('light');
              setOpen(false);
            }}
          >
            <Sun className="h-4 w-4" />
            <span>Theme: Light</span>
          </CommandItem>
          <CommandItem
            value="theme dark"
            onSelect={() => {
              setTheme('dark');
              setOpen(false);
            }}
          >
            <Moon className="h-4 w-4" />
            <span>Theme: Dark</span>
          </CommandItem>
        </CommandGroup>
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>Press</span>
          <span className="flex items-center gap-1">
            <CommandShortcut>⌘K</CommandShortcut>
            <span>to toggle</span>
          </span>
        </div>
      </CommandList>
    </CommandDialog>
  );
}
