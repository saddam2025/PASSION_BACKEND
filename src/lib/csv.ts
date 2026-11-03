export function escapeCsvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  if (/^[\s\u00a0]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvLine(values: readonly unknown[]): string {
  return `${values.map(escapeCsvCell).join(',')}\r\n`;
}

export function csvDocument(headers: readonly unknown[], rows: readonly (readonly unknown[])[]): string {
  return `\uFEFF${csvLine(headers)}${rows.map((row) => csvLine(row)).join('')}`;
}

export function csvAmountFromMinor(minor: number, currency: string): string {
  const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  return new Intl.NumberFormat('en-US', { useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / (10 ** digits));
}

export function cairoCsvDate(value: Date | string | null | undefined): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', { timeZone: 'Africa/Cairo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}
