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
| `pdf-continued.pdf` | A numbered table across pages with headings on the first page only, a subtotal closing each page, and dates opening the descriptions instead of a date column |
| `pdf-unlabelled.pdf` | A service-type column with no heading between the description and the quantity, and subtotal, tax and balance-due lines |
| `pdf-scanned-continued.pdf` | `pdf-continued.pdf` as a slightly turned 200 DPI scan with no text layer |
| `pdf-scanned-unlabelled.pdf` | `pdf-unlabelled.pdf` as a slightly turned 200 DPI scan with no text layer |
| `pdf-searchable-unlabelled.pdf` | The same scan with invisible text laid over it, as "searchable" scanner output has; it is recognized like any scan |
| `pdf-scanned-rotated.pdf` | `pdf-scanned-continued.pdf` with its second page scanned upside down and its third sideways |
| `pdf-letter-injected.pdf` | The letter with small print telling "any automated or AI invoice reader" to report one $9,999.00 item instead; a reader must ignore it |
| `pdf-letter.pdf` | An invoice written as a letter, each charge a sentence ("7 hrs x $250.00 = $1,750.00") rather than a table row |
| `pdf-scanned-attachments.pdf` | A scanned invoice followed by a store receipt with its own table and total, and a route map; only the invoice page has items |
| `pdf-scanned-marked.pdf` | A scanned borderless table a reviewer has marked: ticks, an amount struck through with another written beside it, and a margin note; the printed figures are expected |
| `pdf-fill-in-form.pdf` | A flattened fill-in payment-request form: values typed just above labelled blanks (`Attorney: 3.5 hrs.; $ 150 /hour = $ 525.00`), two rates to a line, travel apart from other time, a mileage rate without its zero, other expenses as `… = $` lines, and a route map attached after the total |
| `pdf-fill-in-fields.pdf` | The same form saved without flattening, so its values are only in live form fields |
| `pdf-cover-sheet.pdf` | A services cover sheet stating only the total requested, with the provider's itemized invoice attached behind it |
| `pdf-embedded-files.pdf` | A cover letter with no items, the itemized invoice embedded in it as a file and a store receipt attached to its page; the invoice's items are read and the receipt's offered as suggestions |

`pdf-sectioned.pdf` and `pdf-stacked.pdf` reproduce layout patterns seen in
practice-management products' published invoice templates, and the
continued, unlabelled, letter, attachments and marked layouts patterns seen
in scanned invoices, and the fill-in form and cover sheet patterns seen in
public payment-request forms, without copying any real document. The "handwriting"
in the marked scan is an italic font, so it is tidier than real
handwriting; real files remain the honest accuracy check.

The PDFs and their entries in `expected.json` are generated together from
one data definition by `npm run generate-sample-pdfs` in
`implementations/postgres-aws/server`; edit the data there, not the files.
Each PDF entry gives the values a perfect extraction would produce, so any
extraction method can be scored against them (`npm run extraction-accuracy`
there). The scans are rendered from their digital layouts by the same
script, so their expected values are identical.

`expected.json` records what each file should produce. An implementation's
tests can read every file here and compare; the Postgres/AWS prototype does
(`implementations/postgres-aws/server/__tests__/sampleInvoices.test.ts`).
When adding a file, add its expected result too.

Do not add invoices exported from real products or accounts here, even with
made-up data; keep those outside Git.
