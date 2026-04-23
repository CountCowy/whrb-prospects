'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const CATEGORIES = [
  { value: 'bug', label: 'Bug' },
  { value: 'idea', label: 'Idea' },
  { value: 'data_issue', label: 'Data issue' },
  { value: 'other', label: 'Other' },
] as const;

const MAX = 2000;

type Variant = 'inline' | 'modal';

type Props = {
  variant?: Variant;
  open?: boolean;
  onClose?: () => void;
};

export function FeedbackWidget({ variant = 'inline', open, onClose }: Props) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]['value']>('other');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (variant === 'modal' && open) {
      // Radix Dialog autofocus lands on the first focusable — bias to the
      // body textarea so the user can type immediately.
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [variant, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmed = body.trim();
    if (trimmed.length < 1 || trimmed.length > MAX) {
      toast.error(`Feedback must be 1–${MAX} characters.`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: trimmed,
          category,
          page_url: window.location.href,
          user_agent: navigator.userAgent,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Submit failed (${res.status})`);
      }
      toast.success('Thanks — feedback logged.');
      setBody('');
      setCategory('other');
      router.refresh();
      onClose?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  }

  const form = (
    <form
      onSubmit={submit}
      data-testid="feedback-form"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Label className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
          Category
        </Label>
        <div
          className="flex flex-wrap gap-1"
          role="radiogroup"
          aria-label="Feedback category"
        >
          {CATEGORIES.map((c) => {
            const active = category === c.value;
            return (
              <Button
                key={c.value}
                type="button"
                role="radio"
                variant="outline"
                size="sm"
                aria-checked={active}
                data-testid={`feedback-category-${c.value}`}
                onClick={() => setCategory(c.value)}
                className={cn(
                  'h-7 rounded-full px-3 text-xs font-medium',
                  active
                    ? 'border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary-soft-hover))]'
                    : 'text-muted-foreground',
                )}
              >
                {c.label}
              </Button>
            );
          })}
        </div>
      </div>
      <Textarea
        ref={textareaRef}
        data-testid="feedback-body"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX))}
        placeholder="What happened / what would help?"
        className="min-h-[96px] resize-y"
      />
      <div className="flex items-center justify-between">
        <span
          className="text-[11px] text-muted-foreground"
          data-testid="feedback-count"
        >
          {body.trim().length}/{MAX}
        </span>
        <div className="flex items-center gap-2">
          {variant === 'modal' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="text-xs"
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            data-testid="feedback-submit"
            disabled={submitting || body.trim().length === 0}
            className="text-xs"
          >
            {submitting ? 'Sending…' : 'Send feedback'}
          </Button>
        </div>
      </div>
    </form>
  );

  if (variant === 'inline') {
    return (
      <section
        data-testid="feedback-inline"
        className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-sm)]"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Send feedback</h2>
          <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Bugs · ideas · data fixes
          </span>
        </div>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          Anything off? Noting a wrong phone number, missed sponsor, or half-broken view helps fix it quickly.
        </p>
        {form}
      </section>
    );
  }

  // Modal variant now uses shadcn Dialog (Radix-backed) so focus-trap,
  // ESC-close, backdrop-click, and ARIA `aria-modal="true"` + `role="dialog"`
  // come for free. Preserves the `feedback-modal` testid for e2e.
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
    >
      <DialogContent
        aria-label="Send feedback"
        data-testid="feedback-modal"
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}
