'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Variant = 'nav' | 'drawer' | 'settings';

const CLASSES: Record<Variant, string> = {
  nav: 'rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-1.5 text-sm font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-50',
  drawer:
    'flex w-full items-center justify-between rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))] disabled:opacity-50',
  settings:
    'inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-transparent px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))] disabled:opacity-50',
};

export function SignOutButton({
  variant = 'nav',
  testId = 'sign-out',
  onBeforeSignOut,
}: {
  variant?: Variant;
  testId?: string;
  onBeforeSignOut?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    try {
      onBeforeSignOut?.();
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className={CLASSES[variant]}
      data-testid={testId}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
