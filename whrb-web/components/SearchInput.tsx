'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Search, X } from 'lucide-react';

const DEBOUNCE_MS = 250;

export function SearchInput({ placeholder = 'Search prospects…' }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get('q') ?? '';
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushed = useRef(initial);

  useEffect(() => {
    // Keep the input aligned with the URL when the user navigates back/forward.
    setValue(params.get('q') ?? '');
    lastPushed.current = params.get('q') ?? '';
  }, [params]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (value === lastPushed.current) return;
      const next = new URLSearchParams(params.toString());
      if (value) next.set('q', value);
      else next.delete('q');
      // Reset page to 1 on any new query.
      next.delete('page');
      lastPushed.current = value;
      router.push(`${pathname}?${next.toString()}`);
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, params, pathname, router]);

  // Wrap the input in a form so iOS dismisses the soft keyboard on Return.
  // Native form-submit behaviour blurs the active input; we still
  // preventDefault to stop a page reload and rely on the existing debounced
  // URL push for filtering. Calling .blur() explicitly covers edge cases
  // where the submit doesn't fire (e.g., other keyboards that don't emit
  // a submit event on Enter).
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        inputRef.current?.blur();
      }}
      className="relative w-full sm:max-w-sm"
    >
      <Search
        aria-hidden="true"
        className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
      />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search prospects"
        placeholder={placeholder}
        value={value}
        enterKeyHint="search"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className="w-full rounded-lg border border-[hsl(var(--input))] bg-[hsl(var(--surface))] py-2 pr-9 pl-9 text-sm text-[hsl(var(--foreground))] shadow-[var(--shadow-xs)] transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--ring)/0.2)] focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => setValue('')}
          aria-label="Clear search"
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
