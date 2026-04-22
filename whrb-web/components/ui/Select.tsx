import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, id, children, ...props }, ref) => {
    const reactId = React.useId();
    const selectId = id ?? reactId;
    const field = (
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full appearance-none rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--surface))] py-1.5 pr-8 pl-3 text-sm text-[hsl(var(--foreground))] transition-colors focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--ring)/0.25)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]"
        />
      </div>
    );

    if (!label) return field;
    return (
      <div className="flex flex-col gap-1">
        <label
          htmlFor={selectId}
          className="text-[11px] font-medium tracking-wider text-[hsl(var(--muted-foreground))] uppercase"
        >
          {label}
        </label>
        {field}
      </div>
    );
  },
);
Select.displayName = 'Select';
