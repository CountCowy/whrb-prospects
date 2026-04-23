'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';

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
import {
  COMMAND_PALETTE_ROUTES,
  type CommandRoute,
} from '@/components/command-palette-routes';

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

  const sections = useMemo(() => {
    const visible = COMMAND_PALETTE_ROUTES.filter(
      (r) => !r.adminOnly || isAdmin,
    );
    const byHeading = new Map<string, CommandRoute[]>();
    for (const r of visible) {
      const list = byHeading.get(r.section) ?? [];
      list.push(r);
      byHeading.set(r.section, list);
    }
    return Array.from(byHeading.entries());
  }, [isAdmin]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      aria-label="Command palette"
    >
      <CommandInput
        placeholder="Jump to page or run a command…"
        data-testid="command-palette-input"
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {sections.map(([heading, routes], sectionIdx) => (
          <div key={heading}>
            {sectionIdx > 0 ? <CommandSeparator /> : null}
            <CommandGroup heading={heading}>
              {routes.map((r) => (
                <CommandItem
                  key={r.href}
                  value={r.value ?? r.label}
                  onSelect={() => go(r.href)}
                >
                  <span>{r.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </div>
        ))}

        <CommandSeparator />
        <CommandGroup heading="Theme">
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
