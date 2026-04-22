'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';

interface Props {
  searchParams: Promise<{
    next?: string;
    sent?: string;
    error?: string;
    deactivated?: string;
  }>;
}

export function LoginForm({ searchParams }: Props) {
  const params = use(searchParams);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(Boolean(params.sent));

  // Some Supabase flows (notably admin-generated magic links) land back here
  // with `#access_token=...&refresh_token=...` in the URL hash instead of the
  // `?code=` query param the PKCE route expects. Detect that and finish the
  // sign-in client-side via setSession, which writes the ssr auth cookies.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash.slice(1);
    if (!hash.includes('access_token=')) return;
    const h = new URLSearchParams(hash);
    const access_token = h.get('access_token');
    const refresh_token = h.get('refresh_token');
    if (!access_token || !refresh_token) return;
    const supabase = createClient();
    void supabase.auth
      .setSession({ access_token, refresh_token })
      .then(({ error }) => {
        if (error) {
          toast.error(error.message);
          return;
        }
        const next = params.next ?? '/';
        window.history.replaceState(null, '', '/login');
        router.replace(next);
      });
  }, [params.next, router]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    try {
      const supabase = createClient();
      const next = params.next ?? '/';
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setSent(true);
      toast.success('Magic link sent. Check your inbox.');
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-lg border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] p-4 text-sm">
        <div className="flex items-start gap-3">
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 flex-shrink-0 text-[hsl(var(--primary))]"
            aria-hidden="true"
          >
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <path d="m22 7-10 5L2 7" />
          </svg>
          <div>
            <p className="font-medium text-[hsl(var(--foreground))]">
              Magic link sent
            </p>
            <p className="mt-1 text-[hsl(var(--muted-foreground))]">
              Check <strong>{email || 'your inbox'}</strong> and click the link
              to sign in.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block text-sm font-medium">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 block w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3.5 py-2.5 text-sm shadow-[var(--shadow-sm)] transition-shadow focus:border-[hsl(var(--ring))] focus:outline-none focus:shadow-[var(--shadow-glow)]"
          placeholder="you@example.com"
        />
      </label>
      {params.error ? (
        <p className="text-sm text-[hsl(var(--destructive))]">{params.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={sending}
        className="w-full rounded-lg bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--primary-foreground))] shadow-[var(--shadow-sm)] transition-all hover:brightness-110 hover:shadow-[var(--shadow-md)] active:brightness-95 disabled:opacity-50"
      >
        {sending ? 'Sending…' : 'Send magic link'}
      </button>
    </form>
  );
}
