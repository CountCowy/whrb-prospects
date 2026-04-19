import { LoginForm } from './LoginForm';

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sent?: string; error?: string }>;
}) {
  return (
    <div className="accent-gradient relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(var(--primary))]/40 to-transparent"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/whrb-logo.svg" alt="WHRB" className="h-9 w-auto" />
          <span className="text-xs font-medium uppercase tracking-[0.22em] text-[hsl(var(--muted-foreground))]">
            Sales
          </span>
        </div>
        <div className="rounded-2xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-8 shadow-[var(--shadow-md)]">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            We&rsquo;ll email you a one-time magic link. Access is admin-invite
            only.
          </p>
          <div className="mt-6">
            <LoginForm searchParams={searchParams} />
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
          Harvard Radio Broadcasting · 95.3 FM
        </p>
      </div>
    </div>
  );
}
