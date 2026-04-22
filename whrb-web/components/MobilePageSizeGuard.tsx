'use client';

import { useEffect } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * On narrow viewports, override the default pageSize to 25. The server
 * default (50) is fine for desktop tables but too dense for phone card
 * lists. This guard runs client-side on first mount; if the user is on
 * a mobile viewport AND has not explicitly chosen a pageSize in the URL,
 * we append `?pageSize=25` and let the route re-render.
 *
 * Accepts `mobilePageSize` so different pages can choose their own
 * mobile default if needed (prospects / my default to 25).
 */
export function MobilePageSizeGuard({
  mobilePageSize = 25,
  mobileMaxWidth = 767,
}: {
  mobilePageSize?: number;
  mobileMaxWidth?: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (searchParams.get('pageSize')) return;
    const isMobile = window.matchMedia(`(max-width: ${mobileMaxWidth}px)`).matches;
    if (!isMobile) return;
    const next = new URLSearchParams(Array.from(searchParams.entries()));
    next.set('pageSize', String(mobilePageSize));
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [router, pathname, searchParams, mobileMaxWidth, mobilePageSize]);

  return null;
}
