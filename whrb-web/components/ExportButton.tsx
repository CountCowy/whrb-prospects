'use client';

import { useState } from 'react';
import { toast } from 'sonner';

type Props = {
  endpoint: string;
  buildQuery?: () => Record<string, string | undefined>;
  label?: string;
  testId?: string;
};

export function ExportButton({
  endpoint,
  buildQuery,
  label = 'Export',
  testId = 'export-button',
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<'csv' | 'xlsx' | null>(null);

  async function run(format: 'csv' | 'xlsx') {
    setPending(format);
    setOpen(false);
    try {
      const qp = new URLSearchParams();
      qp.set('format', format);
      if (buildQuery) {
        for (const [k, v] of Object.entries(buildQuery())) {
          if (v) qp.set(k, v);
        }
      }
      const res = await fetch(`${endpoint}?${qp.toString()}`, { method: 'GET' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? `Export failed (${res.status}).`);
        return;
      }
      const disposition = res.headers.get('content-disposition') ?? '';
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? `export.${format}`;
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast.success(`Downloaded ${filename}.`);
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="relative inline-block" data-testid={testId}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending !== null}
        className="inline-flex items-center gap-1.5 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))] disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
        <span>{pending ? `Generating ${pending.toUpperCase()}…` : label}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-lg"
        >
          <button
            type="button"
            onClick={() => run('csv')}
            data-testid={`${testId}-csv`}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--muted))]"
          >
            CSV
          </button>
          <button
            type="button"
            onClick={() => run('xlsx')}
            data-testid={`${testId}-xlsx`}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-[hsl(var(--muted))]"
          >
            XLSX
          </button>
        </div>
      ) : null}
    </div>
  );
}
