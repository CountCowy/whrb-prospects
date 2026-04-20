'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

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
      setTimeout(() => textareaRef.current?.focus(), 10);
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
        <label className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
          Category
        </label>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Feedback category">
          {CATEGORIES.map((c) => {
            const active = category === c.value;
            return (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`feedback-category-${c.value}`}
                onClick={() => setCategory(c.value)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))]'
                    : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        data-testid="feedback-body"
        value={body}
        onChange={(e) => setBody(e.target.value.slice(0, MAX))}
        placeholder="What happened / what would help?"
        className="min-h-[96px] w-full resize-y rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--surface))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary)/0.2)]"
      />
      <div className="flex items-center justify-between">
        <span
          className="text-[11px] text-[hsl(var(--muted-foreground))]"
          data-testid="feedback-count"
        >
          {body.trim().length}/{MAX}
        </span>
        <div className="flex items-center gap-2">
          {variant === 'modal' && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            data-testid="feedback-submit"
            disabled={submitting || body.trim().length === 0}
            className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send feedback'}
          </button>
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
          <span className="text-[11px] font-medium uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
            Bugs · ideas · data fixes
          </span>
        </div>
        <p className="mt-1 mb-4 text-sm text-[hsl(var(--muted-foreground))]">
          Anything off? Noting a wrong phone number, missed sponsor, or half-broken view helps fix it quickly.
        </p>
        {form}
      </section>
    );
  }

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Send feedback"
      data-testid="feedback-modal"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 px-4 pb-4 pt-24 sm:items-center sm:pb-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-[var(--shadow-md)]">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Send feedback</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m18 6-12 12" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
        {form}
      </div>
    </div>
  );
}
