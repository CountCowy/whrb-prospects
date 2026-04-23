/**
 * Palette contrast assertions — button-fill pairs only.
 *
 * Parses the HSL tokens defined in app/globals.css and verifies every
 * button-fill (bg, fg) pair clears WCAG AA (4.5:1) for normal text.
 * The WCAG luminance helper is inline (<20 LOC) — no external dep.
 *
 * SCOPE NOTE (deviation from foundation plan §227 — documented in the
 * commit message): the plan also lists `--tier-*` and `--state-*-bg`
 * pairs. Chips render a full-saturation color as *text* over a
 * *translucent* same-hue overlay that sits above the page background;
 * contrast depends on an alpha-composite blend that can't be computed
 * correctly in <20 LOC of pure-HSL math. The `@axe-core/playwright`
 * spec added in commit 8 exercises the rendered pages in Chromium and
 * surfaces real chip-contrast regressions; that's the authoritative
 * gate for translucent overlays. This Vitest file intentionally sticks
 * to unambiguous bg/fg pairs.
 *
 * Extends naturally: T3 tag chips, T4 dashboard delta tiles, etc. that
 * introduce new opaque bg/fg pairs append to `PAIRS` below.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// --- WCAG luminance helpers (inline, <20 LOC) -----------------------------

type HSL = { h: number; s: number; l: number };

function parseHsl(raw: string): HSL {
  const bare = raw.split('/')[0].trim();
  const parts = bare.split(/\s+/).map((p) => Number.parseFloat(p));
  if (parts.length < 3 || parts.some(Number.isNaN)) {
    throw new Error(`Malformed HSL triple: "${raw}"`);
  }
  return { h: parts[0], s: parts[1] / 100, l: parts[2] / 100 };
}

function hslToRgb({ h, s, l }: HSL): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x];
  const m = l - c / 2;
  return [r1 + m, g1 + m, b1 + m];
}

function relLuminance(rgb: [number, number, number]): number {
  const chan = (v: number) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const [r, g, b] = rgb.map(chan) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: HSL, b: HSL): number {
  const la = relLuminance(hslToRgb(a));
  const lb = relLuminance(hslToRgb(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Token extraction -----------------------------------------------------

const CSS_PATH = join(__dirname, '..', '..', 'app', 'globals.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

function extractScope(selector: ':root' | '.dark'): string {
  const start = CSS.indexOf(selector + ' {');
  if (start < 0) throw new Error(`Could not find ${selector} block`);
  const openBrace = CSS.indexOf('{', start);
  let depth = 1;
  let i = openBrace + 1;
  while (depth > 0 && i < CSS.length) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') depth--;
    i++;
  }
  return CSS.slice(openBrace + 1, i - 1);
}

function tokenMap(scope: string): Map<string, string> {
  const out = new Map<string, string>();
  // Strip /* ... */ comments — otherwise a comment line like
  //   `* --warning-foreground: plan said ...`
  // pollutes the regex with a spurious match.
  const uncommented = scope.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(uncommented))) {
    const [, name, value] = m;
    const trimmed = value.trim();
    if (trimmed.startsWith('#')) continue;
    if (trimmed.includes('hsl(') || trimmed.includes('rgb(')) continue;
    if (trimmed.includes('calc(')) continue;
    if (!/^\d+(\.\d+)?\s+\d+(\.\d+)?%?\s+\d+(\.\d+)?%?/.test(trimmed)) continue;
    out.set(name, trimmed);
  }
  return out;
}

const LIGHT = tokenMap(extractScope(':root'));
const DARK = tokenMap(extractScope('.dark'));

function hsl(map: Map<string, string>, name: string): HSL {
  const raw = map.get(name);
  if (!raw) throw new Error(`Token --${name} not found`);
  return parseHsl(raw);
}

// --- Button-fill pair table -----------------------------------------------

const PAIRS: Array<readonly [string, string, string]> = [
  ['primary', 'primary-foreground', 'primary fill'],
  ['destructive', 'destructive-foreground', 'destructive fill'],
  ['success', 'success-foreground', 'success fill'],
  ['warning', 'warning-foreground', 'warning fill'],
  ['info', 'info-foreground', 'info fill'],
] as const;

const AA = 4.5;

function suite(label: string, map: Map<string, string>) {
  describe(`${label} mode contrast (≥ ${AA}:1 WCAG AA)`, () => {
    for (const [bgName, fgName, description] of PAIRS) {
      it(`${description}: --${bgName} vs --${fgName}`, () => {
        const ratio = contrast(hsl(map, bgName), hsl(map, fgName));
        expect(
          ratio,
          `${description} (${label}): ratio=${ratio.toFixed(2)} between --${bgName} and --${fgName}`,
        ).toBeGreaterThanOrEqual(AA);
      });
    }
  });
}

suite('Light', LIGHT);
suite('Dark', DARK);
