'use client';

import { Search as SearchIcon, X as XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 250;

export function SearchInput({ placeholder = 'Search prospects…' }: { placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get('q') ?? '';
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushed = useRef(initial);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
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
      next.delete('page');
      lastPushed.current = value;
      router.push(`${pathname}?${next.toString()}`);
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, params, pathname, router]);

  // Wrap in a form so iOS dismisses the soft keyboard on Return.
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        inputRef.current?.blur();
      }}
      className="relative w-full sm:max-w-sm"
    >
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
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
        className={cn('pl-9 pr-9')}
      />
      {value ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setValue('')}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
        >
          <XIcon className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </form>
  );
}
