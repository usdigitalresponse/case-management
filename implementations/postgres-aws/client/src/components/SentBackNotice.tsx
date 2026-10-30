import { Notice } from './Notice';

// Why staff sent a draft back (model/rules.yaml match_invoice_to_case), shown
// until it's sent again.
export function SentBackNotice({ reason }: { reason: string | null }) {
  return reason ? (
    <Notice tone="danger" heading="The billing office sent this back for changes.">
      {reason} Make the changes, then send it again.
    </Notice>
  ) : null;
}
