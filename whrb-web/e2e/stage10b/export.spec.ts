import { test, expect } from '@playwright/test';
import { ADMIN_STORAGE, snapshotExists } from './helpers';

test.describe('stage10b export', () => {
  test.skip(!snapshotExists(), 'Stage 10b snapshot missing');
  test.describe.configure({ mode: 'serial' });
  test.use({ storageState: ADMIN_STORAGE });

  test('stage10b-t13 CSV export downloads with header + rows', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/`);
    const csv = await page.request.get(
      `${baseURL}/api/prospects/export?format=csv&tier=A`,
      { headers: { accept: 'text/csv' } },
    );
    expect(csv.ok()).toBeTruthy();
    const text = await csv.text();
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0].toLowerCase()).toContain('company');
  });

  test('stage10b-t14-t15 XLSX export + rate-limit 429 on back-to-back calls', async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(180_000);
    // Wait out T13's rate-limit window (T13 fired at t=0, window=60s).
    await page.goto(`${baseURL}/`);
    await new Promise((r) => setTimeout(r, 62_000));

    // T14: XLSX download.
    const xlsxRes = await page.request.get(
      `${baseURL}/api/prospects/export?format=xlsx&tier=A`,
    );
    expect(xlsxRes.ok()).toBeTruthy();
    expect(xlsxRes.headers()['content-type']).toContain(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const buf = await xlsxRes.body();
    expect(buf.slice(0, 2).toString('ascii')).toBe('PK');
    expect(buf.length).toBeGreaterThan(1000);

    // T15: immediate follow-up export in the SAME browser context is rate-limited.
    const tooFast = await page.request.get(
      `${baseURL}/api/prospects/export?format=csv&source=stage10b-t15`,
    );
    expect(tooFast.status()).toBe(429);
    const body = await tooFast.json();
    expect(String(body.error)).toMatch(/rate limit/i);
  });

  test('stage10b-t16 admin event_log export level=error returns only errors', async ({
    page,
    baseURL,
  }) => {
    await page.goto(`${baseURL}/admin/logs`);
    const res = await page.request.get(
      `${baseURL}/api/admin/logs/export?format=csv&level=error`,
    );
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    const rows = parseCsv(text);
    expect(rows.length).toBeGreaterThan(0);
    const header = rows[0];
    const levelIdx = header.findIndex((h) => /^level$/i.test(h.trim()));
    expect(levelIdx).toBeGreaterThanOrEqual(0);
    for (const row of rows.slice(1, Math.min(rows.length, 20))) {
      const cell = (row[levelIdx] ?? '').trim();
      if (cell) expect(cell).toBe('error');
    }
  });
});

/** Minimal RFC 4180 CSV parser — handles quoted cells with commas/newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ''));
}
