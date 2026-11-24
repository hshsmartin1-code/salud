/**
 * Minimal RFC 4180 CSV reader/writer (pure).
 *
 * Writer: quotes a field when it holds the separator, a quote, CR or LF (quotes doubled), CRLF line ends.
 * Reader: BOM-tolerant, quoted fields with embedded separators/newlines, `""` escapes, auto-detected
 * separator (`,` `;` or tab) from the header line.
 */
export type Cell = string | number | null | undefined
export type Delimiter = ',' | ';' | '\t'

export const BOM = '﻿'

export interface CsvFormat {
  delimiter: ',' | ';'
  /** Decimal mark written for numbers. */
  decimal: '.' | ','
}
/** Default: Spanish Excel (Colombia opens `;` files with a decimal comma straight away). */
export const FORMAT_EXCEL_ES: CsvFormat = { delimiter: ';', decimal: ',' }
/** Standard: comma and decimal point (Google Sheets, LibreOffice with English locale, scripts). */
export const FORMAT_STANDARD: CsvFormat = { delimiter: ',', decimal: '.' }

/** Number as text with at most 6 decimals, no exponent, using the requested decimal mark. Empty for null/NaN. */
export function numText(n: number | null | undefined, decimal: '.' | ',' = '.'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return ''
  const s = String(Math.round(n * 1e6) / 1e6)
  const plain = /e/i.test(s) ? n.toFixed(6).replace(/\.?0+$/, '') : s
  return decimal === ',' ? plain.replace('.', ',') : plain
}

function field(v: Cell, delimiter: string, decimal: '.' | ','): string {
  const s = typeof v === 'number' ? numText(v, decimal) : (v ?? '')
  return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Serialises rows (first row = header). UTF-8 BOM first so Excel reads accents; CRLF between lines. */
export function toCsv(rows: Cell[][], format: CsvFormat = FORMAT_EXCEL_ES, bom = true): string {
  const body = rows.map((r) => r.map((c) => field(c, format.delimiter, format.decimal)).join(format.delimiter)).join('\r\n')
  return (bom ? BOM : '') + body + '\r\n'
}

export function detectDelimiter(text: string): Delimiter {
  const head = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? ''
  // Ignore separators inside quotes.
  const bare = head.replace(/"[^"]*"/g, '')
  const counts: [Delimiter, number][] = [
    [',', bare.split(',').length - 1],
    [';', bare.split(';').length - 1],
    ['\t', bare.split('\t').length - 1],
  ]
  counts.sort((a, b) => b[1] - a[1])
  return counts[0]![1] > 0 ? counts[0]![0] : ','
}

/** Parses text into rows of strings. Fully blank lines are dropped. */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  let any = false
  const endRow = () => {
    row.push(cur)
    cur = ''
    if (row.length > 1 || row[0]!.trim() !== '') rows.push(row)
    row = []
    any = false
  }
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += c
      continue
    }
    if (c === '"' && cur === '') {
      quoted = true
      any = true
    } else if (c === delimiter) {
      row.push(cur)
      cur = ''
      any = true
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      endRow()
    } else {
      cur += c
      any = true
    }
  }
  if (any || cur !== '' || row.length) endRow()
  return rows
}

/** Rows → objects keyed by the (trimmed) header. Short rows get empty strings. */
export function toRecords(rows: string[][]): { headers: string[]; records: Record<string, string>[] } {
  const headers = (rows[0] ?? []).map((h) => h.trim())
  const records = rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])))
  return { headers, records }
}

/** "12,5" / "12.5" / "1.234,5" / "1,234.5" → number; empty or junk → null. */
export function parseLooseNumber(s: string | undefined): number | null {
  if (s === undefined) return null
  let t = s.trim().replace(/\s/g, '')
  if (!t) return null
  const lastComma = t.lastIndexOf(',')
  const lastDot = t.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  else if (lastComma >= 0) t = t.replace(',', '.')
  if (!/^-?\d*\.?\d+$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
