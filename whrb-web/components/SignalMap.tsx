import Link from 'next/link';
import { SIGNAL_CITIES, type SignalCity } from '@/config/rate-card';

/**
 * Inline SVG signal-area map. Three concentric rings (Local solid /
 * Distant medium / Fringe light) over a stylized New England backdrop;
 * city dots show coverage at a glance.
 *
 * Accessibility strategy:
 *   - The SVG itself is **purely decorative**: `role="img"` + a
 *     descriptive `aria-label` summarising what's drawn. Internal
 *     elements use `aria-hidden="true"` so axe doesn't flag the dots
 *     as nameless interactive elements.
 *   - Keyboard + screen-reader users navigate via the paired
 *     `<details>` fallback list below the SVG — every city is a real
 *     `<a>` anchor with the same `?affiliation=<slug>` query.
 *   - On mouse, hovering the SVG city dots highlights the matching
 *     `<details>` row via plain CSS (not interactive).
 *   - Dark-mode safe: ring strokes use `stroke-current` so the parent
 *     text color drives them.
 */
export function SignalMap() {
  const local = SIGNAL_CITIES.filter((c) => c.ring === 'local');
  const distant = SIGNAL_CITIES.filter((c) => c.ring === 'distant');
  const fringe = SIGNAL_CITIES.filter((c) => c.ring === 'fringe');

  return (
    <section
      data-testid="signal-map-section"
      aria-labelledby="signal-map-heading"
      className="space-y-4"
    >
      <h2
        id="signal-map-heading"
        className="text-xl font-semibold tracking-tight"
      >
        Signal area
      </h2>
      <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
        WHRB transmits at 95.3 MHz from Cambridge with strong signal across
        Greater Boston and a streaming reach worldwide. Three rings: Local
        (core listening area), Distant (reliable reception in good
        conditions), and Fringe (intermittent — covered editorially via
        the New England regional affiliation tag).
      </p>

      <div className="overflow-hidden rounded-xl border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] p-4">
        <svg
          viewBox="0 0 800 500"
          role="img"
          aria-label="WHRB signal area map: Local ring around Cambridge and Boston, Distant ring out to Salem, Worcester, and Plymouth, Fringe ring covering Manchester NH, Hartford CT, and Providence RI."
          data-testid="signal-map-svg"
          className="h-auto w-full text-[hsl(var(--primary))]"
        >
          {/* Backdrop */}
          <rect
            x="0"
            y="0"
            width="800"
            height="500"
            fill="hsl(var(--muted))"
            opacity="0.18"
          />

          {/* Coast outline approximation */}
          <path
            d="M 590 0 Q 580 80 600 160 T 640 280 T 690 380 T 720 480 L 800 500 L 800 0 Z"
            fill="hsl(var(--muted))"
            opacity="0.35"
          />

          {/* Three concentric rings, centered on Cambridge (400,250) */}
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="400" cy="250" r="60" opacity="0.85" />
            <circle cx="400" cy="250" r="120" opacity="0.55" />
            <circle cx="400" cy="250" r="200" opacity="0.32" />
          </g>

          {/* Ring labels */}
          <g
            fill="currentColor"
            fontSize="11"
            fontWeight="600"
            textAnchor="middle"
          >
            <text x="400" y="195">Local</text>
            <text x="400" y="135">Distant</text>
            <text x="400" y="55">Fringe</text>
          </g>

          {/* City dots are aria-hidden — they're decorative only.
              Keyboard + screen-reader users land on the <details>
              fallback list below. */}
          <g aria-hidden="true">
            {SIGNAL_CITIES.map((city) => (
              <CityDot key={city.name} city={city} />
            ))}
          </g>
        </svg>
      </div>

      <details
        data-testid="signal-map-fallback"
        className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--surface))] px-4 py-3 text-sm"
      >
        <summary className="cursor-pointer font-medium">
          Coverage list (text view)
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <RingList title="Local" cities={local} />
          <RingList title="Distant" cities={distant} />
          <RingList title="Fringe" cities={fringe} />
        </div>
      </details>
    </section>
  );
}

function CityDot({ city }: { city: SignalCity }) {
  const dotR = 6;
  return (
    <g data-testid="signal-map-city" data-city={city.name} data-ring={city.ring}>
      <circle
        cx={city.x}
        cy={city.y}
        r={dotR}
        fill="currentColor"
        opacity={city.ring === 'local' ? 1 : city.ring === 'distant' ? 0.7 : 0.4}
      />
      <text
        x={city.x + 10}
        y={city.y + 4}
        fontSize="11"
        fill="currentColor"
        opacity="0.85"
      >
        {city.name}
      </text>
    </g>
  );
}

function RingList({
  title,
  cities,
}: {
  title: string;
  cities: SignalCity[];
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
        {title}
      </div>
      <ul className="mt-1 space-y-1">
        {cities.map((c) => (
          <li key={c.name}>
            <Link
              href={`/prospects?affiliation=${c.affiliationFilter}`}
              className="text-[hsl(var(--primary))] underline underline-offset-2 hover:decoration-2"
              data-testid="signal-map-fallback-link"
              data-city={c.name}
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
