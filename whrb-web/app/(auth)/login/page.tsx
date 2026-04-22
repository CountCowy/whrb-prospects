import { LoginForm } from './LoginForm';
import { Logo } from '@/components/Logo';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    sent?: string;
    error?: string;
    deactivated?: string;
  }>;
}) {
  const params = await searchParams;
  const deactivated = params.deactivated === '1';
  return (
    <div className="accent-gradient relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-primary/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-primary/5 blur-3xl"
      />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-3">
          <Logo className="h-10 w-auto" />
          <span className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Sales
          </span>
        </div>
        <div className="rounded-2xl border border-border-subtle bg-card/80 p-8 shadow-xl backdrop-blur-sm">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-primary">
            Admin invite only
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            We&rsquo;ll email you a one-time magic link. No password required.
          </p>
          {deactivated ? (
            <div
              role="alert"
              data-testid="deactivated-banner"
              className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              Your account has been deactivated. Contact an admin to restore
              access.
            </div>
          ) : null}
          <div className="mt-6">
            <LoginForm searchParams={searchParams} />
          </div>
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Harvard Radio Broadcasting · 95.3 FM
        </p>
      </div>
    </div>
  );
}
