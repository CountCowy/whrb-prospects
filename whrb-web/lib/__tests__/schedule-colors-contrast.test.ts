import { describe, expect, it } from 'vitest';

import { SCHEDULE_COLORS } from '@/styles/schedule-colors';

// Same WCAG-AA contrast check as tag-colors-contrast.test.ts (relative
// luminance via sRGB, with the gamma-corrected channel formula). Each
// chip pair must clear 4.5:1.
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('SCHEDULE_COLORS contrast', () => {
  for (const [category, color] of Object.entries(SCHEDULE_COLORS)) {
    it(`${category} clears WCAG AA (4.5:1)`, () => {
      const ratio = contrast(color.bgHex, color.fgHex);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});
