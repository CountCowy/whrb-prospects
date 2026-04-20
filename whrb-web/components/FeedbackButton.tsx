'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { FeedbackWidget } from '@/components/FeedbackWidget';

function isAllowed(pathname: string): boolean {
  if (pathname === '/') return true;
  if (pathname.startsWith('/prospects')) return true;
  if (pathname === '/my' || pathname.startsWith('/my/')) return true;
  if (pathname === '/team' || pathname.startsWith('/team/')) return true;
  return false;
}

export function FeedbackButton() {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);
  if (!isAllowed(pathname)) return null;
  return (
    <>
      <button
        type="button"
        data-testid="feedback-floating-button"
        aria-label="Send feedback"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] shadow-[var(--shadow-md)] transition-transform hover:-translate-y-0.5 hover:opacity-95 sm:bottom-6 sm:right-6"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
        Feedback
      </button>
      <FeedbackWidget variant="modal" open={open} onClose={() => setOpen(false)} />
    </>
  );
}
