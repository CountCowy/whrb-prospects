'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/**
 * Sign-out behavior shared between SignOutButton (button surface) and the
 * Nav avatar dropdown (DropdownMenuItem surface). Centralizes the Supabase
 * sign-out + router redirect/refresh dance so a `<DropdownMenuItem
 * onSelect={signOut}>` doesn't have to render a `<Button>` inside a Radix
 * menu (which would produce nested interactive roles + visual mismatch).
 *
 * Returns:
 *   - signOut: idempotent under double-click (guarded by `pending`).
 *   - pending: true while the sign-out request is in flight; surface this
 *     to disable the trigger.
 */
export function useSignOut(opts?: { onBeforeSignOut?: () => void }): {
  signOut: () => Promise<void>;
  pending: boolean;
} {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function signOut() {
    if (pending) return;
    setPending(true);
    try {
      opts?.onBeforeSignOut?.();
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push('/login');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return { signOut, pending };
}
