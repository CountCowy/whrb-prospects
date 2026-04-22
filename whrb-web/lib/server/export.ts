import 'server-only';

import ExcelJS from 'exceljs';
import { formatDateTime } from '@/lib/time';

export type ExportColumn = {
  key: string;
  header: string;
  kind?: 'text' | 'date' | 'number' | 'boolean';
};

export function rowsToCsv(rows: Array<Record<string, unknown>>, columns: ExportColumn[]): string {
  const headers = columns.map((c) => c.header);
  const lines: string[] = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    const cells = columns.map((c) => csvEscape(formatCellString(row[c.key], c.kind)));
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

function csvEscape(s: string): string {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function formatCellString(value: unknown, kind?: ExportColumn['kind']): string {
  if (value === null || value === undefined) return '';
  if (kind === 'date' && typeof value === 'string') {
    // Timestamps render in America/New_York to match the rest of the UI.
    return formatDateTime(value);
  }
  if (kind === 'boolean') {
    if (value === true) return 'true';
    if (value === false) return 'false';
    return '';
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export async function rowsToXlsxBuffer(
  rows: Array<Record<string, unknown>>,
  columns: ExportColumn[],
  opts: { sheetName?: string } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'WHRB Sales';
  wb.created = new Date();
  const ws = wb.addWorksheet(opts.sheetName ?? 'Export', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.min(Math.max(c.header.length + 2, 12), 50),
  }));
  ws.getRow(1).font = { bold: true };
  for (const row of rows) {
    const out: Record<string, string | number | boolean | null> = {};
    for (const c of columns) {
      const v = row[c.key];
      if (v === null || v === undefined) {
        out[c.key] = null;
      } else if (c.kind === 'date' && typeof v === 'string') {
        out[c.key] = formatDateTime(v);
      } else if (c.kind === 'boolean') {
        out[c.key] = Boolean(v);
      } else if (c.kind === 'number') {
        const n = typeof v === 'number' ? v : Number(v);
        out[c.key] = Number.isFinite(n) ? n : null;
      } else if (typeof v === 'object') {
        out[c.key] = JSON.stringify(v);
      } else {
        out[c.key] = v as string | number | boolean;
      }
    }
    ws.addRow(out);
  }
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
