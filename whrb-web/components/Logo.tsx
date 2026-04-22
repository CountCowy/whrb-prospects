/**
 * WHRB wordmark. Swaps light/dark variants via Tailwind's `dark:` class
 * variant — no theme hook, no flash on first render. Both variants are
 * in the DOM; CSS hides the inactive one so the right colourway lands
 * on first paint regardless of theme.
 */
export function Logo({
  className = 'h-7 w-auto',
  alt = 'WHRB',
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/whrb-logo.svg"
        alt={alt}
        className={`${className} block dark:hidden`}
        data-testid="whrb-logo-light"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/whrb-logo-dark.svg"
        alt={alt}
        className={`${className} hidden dark:block`}
        data-testid="whrb-logo-dark"
        aria-hidden="true"
      />
    </>
  );
}
