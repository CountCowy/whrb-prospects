'use client';

import { useSearchParams } from 'next/navigation';
import { ExportButton } from '@/components/ExportButton';

export function ExportCurrentFilters({
  endpoint,
  extra,
  label,
  testId,
  allowedKeys,
}: {
  endpoint: string;
  extra?: Record<string, string | undefined>;
  label?: string;
  testId?: string;
  allowedKeys?: string[];
}) {
  const sp = useSearchParams();
  const buildQuery = () => {
    const out: Record<string, string | undefined> = {};
    const keys =
      allowedKeys ??
      [
        'q',
        'tier',
        'state',
        'assigned_to',
        'zip',
        'category',
        'source',
        'is_nonprofit',
        'assigned',
        'mine',
        'level',
        'since',
        'until',
      ];
    for (const k of keys) {
      const v = sp.get(k);
      if (v) out[k] = v;
    }
    if (extra) for (const [k, v] of Object.entries(extra)) if (v) out[k] = v;
    return out;
  };
  return <ExportButton endpoint={endpoint} buildQuery={buildQuery} label={label} testId={testId} />;
}
