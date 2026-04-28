import { describe, expect, it } from 'vitest';

import { normalizeName } from '@/lib/norm-name';

describe('normalizeName', () => {
  it('lowercases and strips ASCII punctuation', () => {
    expect(normalizeName('WGBH-FM')).toBe('wgbhfm');
    expect(normalizeName('Boston Symphony Orchestra')).toBe(
      'boston symphony orchestra',
    );
  });

  it('preserves Unicode letters (matches Python `\\w` semantics)', () => {
    expect(normalizeName('Café Müller')).toBe('café müller');
    expect(normalizeName('文化中心')).toBe('文化中心');
  });

  it('preserves underscores (matches Python `\\w` semantics)', () => {
    expect(normalizeName('foo_bar')).toBe('foo_bar');
  });

  it('collapses internal whitespace and trims', () => {
    expect(normalizeName('  WGBH   89.7   FM  ')).toBe('wgbh 897 fm');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeName('   ')).toBe('');
    expect(normalizeName('')).toBe('');
  });

  it('matches the Python output for every seeded peer_stations row', () => {
    // Seeded display_name → normalized_name pairs from
    // `whrb-web/supabase/migrations/015_peer_stations.sql`. Round-tripping
    // each through normalizeName must reproduce the seeded normalized form.
    const pairs: Array<[string, string]> = [
      ['WHRB', 'whrb'],
      ['WCRB', 'wcrb'],
      ['WGBH', 'wgbh'],
      ['GBH', 'gbh'],
      ['WBUR', 'wbur'],
      ['WUMB', 'wumb'],
      ['WERS', 'wers'],
      ['WNYC', 'wnyc'],
      ['WQXR', 'wqxr'],
      ['NPR', 'npr'],
      ['PRX', 'prx'],
      ['PRI', 'pri'],
      ['PBS', 'pbs'],
      ['Boston Public Radio', 'boston public radio'],
      // 'Classical WCRB' is intentionally seeded as 'classicalwcrb' (no
      // space) — that's a *manual override* from the canonical derivation,
      // and the migration carries it as-is. We don't round-trip this row.
    ];
    for (const [display, expected] of pairs) {
      expect(normalizeName(display)).toBe(expected);
    }
  });
});
