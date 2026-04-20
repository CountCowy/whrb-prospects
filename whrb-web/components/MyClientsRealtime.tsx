'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Subscribes to prospects UPDATEs where assigned_to = currentUserId.
// Triggers router.refresh() so My Clients picks up a new assignment within
// a couple of seconds without a manual reload (Stage 7 T01).
export function MyClientsRealtime({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  useEffect(() => {
    const sb = createClient();
    const channel = sb
      .channel(`my-clients-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'prospects',
          filter: `assigned_to=eq.${currentUserId}`,
        },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [currentUserId, router]);
  return null;
}
