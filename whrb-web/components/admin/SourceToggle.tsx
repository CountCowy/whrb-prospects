'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function SourceToggle({
  sourceKey,
  initialEnabled,
}: {
  sourceKey: string;
  initialEnabled: boolean;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  async function onToggle() {
    const next = !enabled;
    setEnabled(next);
    const res = await fetch(`/api/sources/${encodeURIComponent(sourceKey)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    });
    if (!res.ok) {
      setEnabled(!next);
      const msg = await res.text();
      toast.error(`Could not toggle ${sourceKey}: ${msg}`);
      return;
    }
    toast.success(`${sourceKey} → ${next ? 'enabled' : 'disabled'}`);
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={`Toggle ${sourceKey}`}
      data-testid={`source-toggle-${sourceKey}`}
      data-enabled={enabled ? 'true' : 'false'}
      disabled={pending}
      onClick={onToggle}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
        enabled
          ? 'border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))]'
          : 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]'
      } ${pending ? 'opacity-60' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-[hsl(var(--background))] shadow transition-transform ${
          enabled ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
