import Link from 'next/link';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { logEvent } from '@/lib/logging/server';

export default async function NotFound() {
  const h = await headers();
  const url = h.get('x-pathname') ?? h.get('referer') ?? '/unknown';

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  await logEvent({
    source: 'web_server',
    level: 'warn',
    category: 'route_404',
    message: `404 ${url}`,
    userId: user?.id ?? null,
    url,
    httpStatus: 404,
  });

  return (
    <div className="mx-auto max-w-xl py-24 text-center">
      <h1 className="text-3xl font-semibold">404 — Not Found</h1>
      <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
        That page doesn&rsquo;t exist.{' '}
        <Link href="/" className="underline">
          Head home
        </Link>
        .
      </p>
    </div>
  );
}
