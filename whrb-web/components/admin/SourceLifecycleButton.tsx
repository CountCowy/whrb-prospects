'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import type { SourceStatus } from '@/lib/queries/sources';

export function SourceLifecycleButton({
  sourceKey,
  status,
}: {
  sourceKey: string;
  status: SourceStatus;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  // Only `active` rows show "Propose sunset"; any transitional state
  // shows "Revert" back to active.
  const isActive = status === 'active';
  const action = isActive ? 'propose_sunset' : 'revert_to_active';
  const label = isActive ? 'Propose sunset' : 'Revert to active';

  async function handleClick() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/sources/${encodeURIComponent(sourceKey)}/lifecycle`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error || `Failed to ${action.replace(/_/g, ' ')}`);
        return;
      }
      const body = await res.json();
      toast.success(`${sourceKey}: ${body.from} → ${body.to}`);
      startTransition(() => router.refresh());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={isActive ? 'outline' : 'default'}
      size="sm"
      data-testid="source-lifecycle-button"
      data-source-key={sourceKey}
      data-action={action}
      disabled={busy || pending || status === 'archived'}
      onClick={handleClick}
    >
      {busy || pending ? 'Working…' : label}
    </Button>
  );
}
