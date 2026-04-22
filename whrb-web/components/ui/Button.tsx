import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--background))]',
  {
    variants: {
      variant: {
        primary:
          'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] border border-[hsl(var(--primary-soft-border))] shadow-[var(--shadow-xs)] hover:bg-[hsl(var(--primary-600))] active:bg-[hsl(var(--primary-700))]',
        secondary:
          'bg-[hsl(var(--surface))] text-[hsl(var(--foreground))] border border-[hsl(var(--border))] shadow-[var(--shadow-xs)] hover:bg-[hsl(var(--muted))] active:bg-[hsl(var(--surface-2))]',
        outline:
          'bg-transparent text-[hsl(var(--foreground))] border border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] hover:border-[hsl(var(--border-strong))]',
        ghost:
          'bg-transparent text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]',
        destructive:
          'bg-[hsl(var(--destructive))] text-[hsl(var(--destructive-foreground))] shadow-[var(--shadow-xs)] hover:opacity-90 active:opacity-80',
        soft: 'bg-[hsl(var(--primary-soft))] text-[hsl(var(--primary))] border border-[hsl(var(--primary-soft-border))] hover:bg-[hsl(var(--primary-soft-hover))]',
      },
      size: {
        sm: 'h-8 px-2.5 text-xs',
        md: 'h-9 px-3 text-sm',
        lg: 'h-10 px-4 text-sm',
        icon: 'h-9 w-9 p-0',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  leadingIcon?: LucideIcon;
  trailingIcon?: LucideIcon;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      leadingIcon: LeadingIcon,
      trailingIcon: TrailingIcon,
      children,
      ...props
    },
    ref,
  ) => {
    return (
      <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {LeadingIcon ? <LeadingIcon className="h-4 w-4" aria-hidden="true" /> : null}
        {children}
        {TrailingIcon ? <TrailingIcon className="h-4 w-4" aria-hidden="true" /> : null}
      </button>
    );
  },
);
Button.displayName = 'Button';
