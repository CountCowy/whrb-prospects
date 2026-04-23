'use client';

import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
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
      <Button
        type="button"
        data-testid="feedback-floating-button"
        aria-label="Send feedback"
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-40 gap-2 rounded-full shadow-md transition-transform hover:-translate-y-0.5 sm:bottom-6 sm:right-6"
      >
        <MessageCircle className="h-4 w-4" />
        Feedback
      </Button>
      <FeedbackWidget variant="modal" open={open} onClose={() => setOpen(false)} />
    </>
  );
}
