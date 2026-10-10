# Synthetic supporting invoices

Files for trying and testing supporting invoice import
(`scenarios/invoice-import-export.md`). Every name, number, amount and date is
synthetic; none comes from a real firm, matter or billing product. Task,
activity and expense codes follow the public UTBMS code set.

| File | Shows |
| --- | --- |
| `ledes-1998b-basic.txt` | A clean LEDES 1998B invoice: three fee lines for two timekeepers and one expense |
| `ledes-1998b-warnings.txt` | A stated total that doesn't match its items, hours × rate that doesn't match an amount, a date outside the billing period, and a timekeeper no one will match automatically |
| `ledes-1998b-two-invoices.txt` | A bulk export covering two invoices, which is refused |
| `template-basic.csv` | The invoice spreadsheet template as CSV, with a quoted description |
| `template-basic.xlsx` | The same items as `template-basic.csv`, as XLSX |
| `template-bad-date.csv` | A template row with a date in the wrong format, which can't be read |
| `pdf-itemized.pdf` | An itemized PDF table with dates, timekeepers, hours, rates and wrapping descriptions |
| `pdf-coded.pdf` | The same items with UTBMS task and activity code columns and a narrow timekeeper column |
| `pdf-summary.pdf` | Totals per timekeeper and for expenses, with no dates or item detail |
| `pdf-voucher.pdf` | A fixed claim form with labelled categories; the counsel's name is outside the table |
| `pdf-multipage.pdf` | A 48-item table running across pages, with column headings on the first page only |
| `pdf-sectioned.pdf` | Separate time and expense tables with their own headings and subtotals, initials for timekeepers, right-aligned amounts and a no-charge entry |
| `pdf-stacked.pdf` | Section titles heading the first column, with each item's activity, date and description stacked in one cell |

The last two reproduce layout patterns seen in practice-management products'
published invoice templates, without copying any product's design.

The PDFs and their entries in `expected.json` are generated together from
one data definition by `npm run generate-sample-pdfs` in
`implementations/postgres-aws/server`; edit the data there, not the files.
Each PDF entry gives the values a perfect extraction would produce, so any
extraction method can be scored against them (`npm run extraction-accuracy`
there). There is no scanned-looking sample yet: producing one needs an image
rasterizer this repository doesn't use.

`expected.json` records what each file should produce. An implementation's
tests can read every file here and compare; the Postgres/AWS prototype does
(`implementations/postgres-aws/server/__tests__/sampleInvoices.test.ts`).
When adding a file, add its expected result too.

Do not add invoices exported from real products or accounts here, even with
made-up data; keep those outside Git.
