/**
 * Tag-axis chip contrast assertions (Stage T3, plan §5.6 T23).
 *
 * Sister to palette-contrast.test.ts. Asserts every (bgHex, fgHex) pair
 * declared in `whrb-web/styles/tag-colors.ts` clears WCAG AA (≥ 4.5:1)
 * for normal text. The chip palette is mode-invariant (saturated solids
 * read on both warm light and warm dark surfaces), so we run a single
 * contrast pass per axis rather than a light/dark matrix.
 *
 * Documented exception: `cadence` uses amber-500 paired with text-zinc-900
 * as the only non-white foreground. Plan §5.4 calls this out explicitly
 * and the test below carries the same justification inline.
 *
 * Manual companion gate: `/admin/palette` dev-only route renders one
 * chip per axis for designer eyeballing under D / P / T simulation.
 * That route is not covered by this Vitest suite; it's covered by the
 * @axe-core/playwright sweep in `e2e/foundation/a11y.spec.ts` once T3
 * extends the route list.
 */
import { describe, expect, it } from 'vitest';

import {
  AXES,
  AXIS_COLORS,
  OVERFLOW_COLOR,
  type Axis,
} from '../../styles/tag-colors';

// --- WCAG luminance helpers (inline; mirrors palette-contrast.test.ts).
function hexToRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace(/^#/, '');
  if (cleaned.length !== 6) {
    throw new Error(`Malformed hex: ${hex}`);
  }
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  return [r, g, b];
}

function relLuminance(rgb: [number, number, number]): number {
  const chan = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const [r, g, b] = rgb.map(chan) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(aHex: string, bHex: string): number {
  const la = relLuminance(hexToRgb(aHex));
  const lb = relLuminance(hexToRgb(bHex));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe('tag chip contrast (≥ 4.5:1 WCAG AA)', () => {
  it('AXES enum stays aligned with AXIS_COLORS keys', () => {
    expect(Object.keys(AXIS_COLORS).sort()).toEqual([...AXES].sort());
  });

  for (const axis of AXES) {
    const c = AXIS_COLORS[axis];
    it(`${axis}: ${c.bg} on ${c.fg}`, () => {
      const ratio = contrast(c.bgHex, c.fgHex);
      expect(
        ratio,
        `${axis}: ratio=${ratio.toFixed(2)} between ${c.bgHex} (${c.bg}) and ${c.fgHex} (${c.fg})`,
      ).toBeGreaterThanOrEqual(AA);
    });
  }

  it('cadence axis is the only documented non-white-fg pair', () => {
    const nonWhite = (AXES as ReadonlyArray<Axis>).filter(
      (a) => AXIS_COLORS[a].fgHex.toLowerCase() !== '#ffffff',
    );
    expect(nonWhite).toEqual(['cadence']);
  });
});

describe('overflow chip contrast (≥ 4.5:1 WCAG AA)', () => {
  it('light: zinc-100 / zinc-700', () => {
    const ratio = contrast(
      OVERFLOW_COLOR.bgHexLight,
      OVERFLOW_COLOR.fgHexLight,
    );
    expect(ratio).toBeGreaterThanOrEqual(AA);
  });
  it('dark: zinc-800 / zinc-300', () => {
    const ratio = contrast(
      OVERFLOW_COLOR.bgHexDark,
      OVERFLOW_COLOR.fgHexDark,
    );
    expect(ratio).toBeGreaterThanOrEqual(AA);
  });
});
