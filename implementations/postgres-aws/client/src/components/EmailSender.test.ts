import { describe, expect, it } from 'vitest';
import type { PortalInvoiceLine, QueuedInvoice } from '../api/client';
import { senderMailto } from './EmailSender';

const invoice = {
  invoiceNumber: 'SYN-0002',
  periodStart: null,
  periodEnd: null,
  submittedAt: null,
  receivedOn: null,
} as QueuedInvoice;
const line = {
  lineTypeCode: 'time',
  serviceDate: '2026-02-02',
  description: 'Research',
  quantity: '2',
  amount: '300.00',
  expenseTypeCode: null,
  tripId: null,
  timeCategory: null,
} as unknown as PortalInvoiceLine;

function draft(href: string) {
  const [to, query] = href.slice('mailto:'.length).split('?');
  const params = new URLSearchParams(query);
  return { to, subject: params.get('subject'), body: params.get('body') };
}

describe('an email to the sender', () => {
  it('leaves the address blank when none is on file, with the case number in its body', () => {
    expect(draft(senderMailto(null, invoice, '26-CR-00418'))).toEqual({
      to: '',
      subject: 'Your invoice SYN-0002 · Case 26-CR-00418',
      body: 'Case number: 26-CR-00418\n\n',
    });
  });

  it('dates its subject by the period, else when it was sent or came in', () => {
    const subject = (dates: Partial<QueuedInvoice>) => draft(senderMailto(null, { ...invoice, ...dates }, '26-CR-00418')).subject;
    expect(subject({ periodStart: '2026-02-01', periodEnd: '2026-02-28', submittedAt: '2026-03-02T15:00:00Z' })).toBe(
      'Your invoice SYN-0002 · Case 26-CR-00418 · 1 Feb 2026 – 28 Feb 2026',
    );
    expect(subject({ submittedAt: '2026-03-02T15:00:00Z' })).toBe('Your invoice SYN-0002 · Case 26-CR-00418 · Sent 2 Mar 2026');
    expect(subject({ receivedOn: '2026-03-03' })).toBe('Your invoice SYN-0002 · Case 26-CR-00418 · Received 3 Mar 2026');
  });

  it('describes each line, with any questions under it', () => {
    const href = senderMailto('sender@example.com', invoice, null, [{ line, number: 3, questions: ['Which filing was this for?'] }]);
    expect(href).not.toContain('+');
    expect(draft(href)).toMatchObject({
      to: 'sender@example.com',
      body: 'Line 3: 2 Feb 2026, Time, Research, 2.00 h, $300.00\nQuestion: Which filing was this for?\n\n',
    });
  });
});
