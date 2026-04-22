import * as React from 'react';
import { cn } from '@/lib/cn';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string | null;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const reactId = React.useId();
    const taId = id ?? reactId;
    const field = (
      <textarea
        ref={ref}
        id={taId}
        aria-invalid={error ? true : undefined}
        className={cn(
          'min-h-[88px] w-full resize-y rounded-md border bg-[hsl(var(--surface))] px-3 py-2 text-sm text-[hsl(var(--foreground))] transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus:ring-2 focus:ring-[hsl(var(--ring)/0.25)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          error
            ? 'border-[hsl(var(--destructive))] focus:border-[hsl(var(--destructive))]'
            : 'border-[hsl(var(--input))] focus:border-[hsl(var(--primary))]',
          className,
        )}
        {...props}
      />
    );
    if (!label && !error) return field;
    return (
      <div className="flex flex-col gap-1">
        {label ? (
          <label
            htmlFor={taId}
            className="text-[11px] font-medium tracking-wider text-[hsl(var(--muted-foreground))] uppercase"
          >
            {label}
          </label>
        ) : null}
        {field}
        {error ? <p className="text-xs text-[hsl(var(--destructive))]">{error}</p> : null}
      </div>
    );
  },
);
Textarea.displayName = 'Textarea';
