'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageSquare } from 'lucide-react';
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
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-soft-border))] bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-xl hover:brightness-110 sm:bottom-6 sm:right-6"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        Feedback
      </button>
      <FeedbackWidget variant="modal" open={open} onClose={() => setOpen(false)} />
    </>
  );
}
