'use client';

import { Button } from '@/components/ui/button';
import { useSignOut } from '@/lib/hooks/use-sign-out';
import { cn } from '@/lib/utils';

type Variant = 'nav' | 'drawer' | 'settings';

export function SignOutButton({
  variant = 'nav',
  testId = 'sign-out',
  onBeforeSignOut,
}: {
  variant?: Variant;
  testId?: string;
  onBeforeSignOut?: () => void;
}) {
  const { signOut, pending } = useSignOut({ onBeforeSignOut });

  const label = pending ? 'Signing out…' : 'Sign out';

  // Match each call site's visual context without forking the component.
  //   nav      → outline pill in the desktop nav right rail.
  //   drawer   → full-width row in the mobile drawer.
  //   settings → standard outline button on the /settings page.
  const variantProps =
    variant === 'drawer'
      ? { variant: 'outline' as const, size: 'default' as const, className: 'w-full justify-between' }
      : variant === 'settings'
        ? { variant: 'outline' as const, size: 'default' as const }
        : { variant: 'outline' as const, size: 'sm' as const };

  return (
    <Button
      type="button"
      onClick={signOut}
      disabled={pending}
      data-testid={testId}
      {...variantProps}
      className={cn(variantProps.className, 'text-muted-foreground hover:text-foreground')}
    >
      {label}
    </Button>
  );
}
