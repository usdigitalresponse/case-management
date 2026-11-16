import { cssVars } from './ui/cssVars';

// How much of a limit is used: approved in green, waiting for a decision in blue (design K49, K55).
// Hidden from screen readers: the figures beside it say the same in words.
export function UsedBar({ approved, waiting, limit }: { approved: number; waiting: number; limit: number }) {
  const share = (amount: number) => `${limit > 0 ? Math.min(100, Math.max(0, (amount / limit) * 100)) : 0}%`;
  return (
    <div className="preauth-bar" aria-hidden="true" style={cssVars({ '--approved': share(approved), '--waiting': share(waiting) })}>
      <span className="preauth-bar__approved" />
      <span className="preauth-bar__waiting" />
    </div>
  );
}
