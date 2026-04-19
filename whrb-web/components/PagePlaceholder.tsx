import type { ReactNode } from 'react';

interface Props {
  eyebrow: string;
  title: string;
  description: string;
  stage: string;
  children?: ReactNode;
}

export function PagePlaceholder({
  eyebrow,
  title,
  description,
  stage,
  children,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            {eyebrow}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {title}
          </h1>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--primary-soft-border))] bg-[hsl(var(--primary-soft))] px-3 py-1 text-xs font-medium text-[hsl(var(--primary))]">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[hsl(var(--primary))]" />
          {stage}
        </span>
      </div>
      <div className="rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-6 shadow-[var(--shadow-sm)]">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">{description}</p>
        {children}
      </div>
    </div>
  );
}
