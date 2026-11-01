// Rows the page already has, saved as a CSV in the browser.
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  // A leading =, +, - or @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows: Array<Record<string, string | number | null | undefined>>): string {
  const headers = Object.keys(rows[0] ?? {});
  return [headers.map(cell).join(','), ...rows.map((row) => headers.map((header) => cell(row[header])).join(','))].join('\n');
}

export function downloadCsv(fileName: string, rows: Array<Record<string, string | number | null | undefined>>): void {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
