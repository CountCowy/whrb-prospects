'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Opt = 'system' | 'light' | 'dark';

const OPTIONS: { value: Opt; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

function iconFor(value: Opt | undefined): typeof Sun {
  if (value === 'light') return Sun;
  if (value === 'dark') return Moon;
  return Monitor;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // next-themes resolves the persisted theme on the client only — so the
  // trigger icon would flash mismatched between SSR (defaults to System)
  // and hydration. Render a stable placeholder until mount.
  useEffect(() => setMounted(true), []);

  const current = (mounted ? (theme as Opt) : 'system') ?? 'system';
  const CurrentIcon = iconFor(current);
  const currentLabel =
    OPTIONS.find((o) => o.value === current)?.label ?? 'System';

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Theme: ${currentLabel}. Click to change.`}
              data-testid="theme-toggle-button"
            >
              <CurrentIcon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Theme · {currentLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="w-36"
        data-testid="theme-toggle-menu"
      >
        <DropdownMenuRadioGroup
          value={current}
          onValueChange={(v) => setTheme(v as Opt)}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
