'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Mail, MailCheck } from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
          <MailCheck
            className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium text-foreground">Magic link sent</p>
            <p className="mt-1 text-muted-foreground">
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
      <div className="space-y-1.5">
        <Label htmlFor="login-email">Email</Label>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="login-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-11 pl-9 text-sm"
          />
        </div>
      </div>
      {params.error ? (
        <p className="text-sm text-destructive">{params.error}</p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        disabled={sending}
        className="w-full shadow-sm"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending…
          </>
        ) : (
          <>
            <Mail className="h-4 w-4" />
            Send magic link
          </>
        )}
      </Button>
    </form>
  );
}
