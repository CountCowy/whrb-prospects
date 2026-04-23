import * as React from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
  leadingIcon?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, hint, error, leadingIcon, id, ...props }, ref) => {
    const reactId = React.useId();
    const inputId = id ?? reactId;
    const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
    const field = (
      <div className="relative">
        {leadingIcon ? (
          <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[hsl(var(--muted-foreground))]">
            {leadingIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'w-full rounded-md border bg-[hsl(var(--surface))] px-3 py-1.5 text-sm text-[hsl(var(--foreground))] transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus:ring-2 focus:ring-[hsl(var(--ring)/0.25)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            error
              ? 'border-[hsl(var(--destructive))] focus:border-[hsl(var(--destructive))]'
              : 'border-[hsl(var(--input))] focus:border-[hsl(var(--primary))]',
            leadingIcon ? 'pl-8' : '',
            className,
          )}
          {...props}
        />
      </div>
    );

    if (!label && !hint && !error) return field;
    return (
      <div className="flex flex-col gap-1">
        {label ? (
          <label
            htmlFor={inputId}
            className="text-[11px] font-medium tracking-wider text-[hsl(var(--muted-foreground))] uppercase"
          >
            {label}
          </label>
        ) : null}
        {field}
        {error ? (
          <p id={`${inputId}-error`} className="text-xs text-[hsl(var(--destructive))]">
            {error}
          </p>
        ) : hint ? (
          <p id={`${inputId}-hint`} className="text-xs text-[hsl(var(--muted-foreground))]">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
