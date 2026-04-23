'use client';

import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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
  const [pending, setPending] = useState<'csv' | 'xlsx' | null>(null);

  async function run(format: 'csv' | 'xlsx') {
    setPending(format);
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending !== null}
          >
            <Download className="h-3.5 w-3.5" />
            <span>
              {pending ? `Generating ${pending.toUpperCase()}…` : label}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void run('csv');
            }}
            data-testid={`${testId}-csv`}
          >
            CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              void run('xlsx');
            }}
            data-testid={`${testId}-xlsx`}
          >
            XLSX
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
