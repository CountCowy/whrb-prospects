'use client';

import { useTheme } from 'next-themes';
import { useEffect, useRef, useState, type ReactNode } from 'react';

type Opt = 'system' | 'light' | 'dark';

const SYSTEM_ICON = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

const LIGHT_ICON = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

const DARK_ICON = (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const OPTIONS: { value: Opt; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: SYSTEM_ICON },
  { value: 'light', label: 'Light', icon: LIGHT_ICON },
  { value: 'dark', label: 'Dark', icon: DARK_ICON },
];

function iconFor(value: Opt | undefined): ReactNode {
  if (value === 'light') return LIGHT_ICON;
  if (value === 'dark') return DARK_ICON;
  return SYSTEM_ICON;
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const currentLabel = OPTIONS.find((o) => o.value === theme)?.label ?? 'System';

  return (
    <div className="relative" ref={wrapRef} data-testid="theme-toggle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Theme: ${currentLabel}. Click to change.`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
        data-testid="theme-toggle-button"
      >
        {mounted ? iconFor(theme as Opt) : SYSTEM_ICON}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Theme"
          className="absolute right-0 z-50 mt-1 w-32 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg"
          data-testid="theme-toggle-menu"
        >
          {OPTIONS.map(({ value, label, icon }) => {
            const active = mounted && theme === value;
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                    : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                }`}
                data-testid={`theme-option-${value}`}
              >
                <span className="inline-flex h-4 w-4 items-center justify-center">
                  {icon}
                </span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
