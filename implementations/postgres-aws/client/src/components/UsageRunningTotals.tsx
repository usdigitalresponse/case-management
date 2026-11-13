// Pre-authorized ceilings against the signed-off invoices they cover, by month (design J).
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { UsageMonth } from '../api/client';
import { formatDollars } from '../formatMoney';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1];
const withYear = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;
const amount = (value: string | null) => (value === null ? null : Number(value));
const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

const SERIES = [
  { key: 'authorized', name: 'Authorized' },
  { key: 'signedOff', name: 'Signed off' },
  { key: 'withInReview', name: 'With invoices in review' },
] as const;

export default function UsageRunningTotals({ months }: { months: UsageMonth[] }) {
  const label = months[0]?.month.slice(0, 4) === months.at(-1)?.month.slice(0, 4) ? monthName : withYear;
  const data = months.map((row) => ({
    month: label(row.month),
    authorized: amount(row.authorized),
    signedOff: amount(row.signedOff),
    withInReview: amount(row.withInReview),
  }));
  const latest = [...months].reverse().find((row) => row.authorized !== null);
  return (
    <section className="card usage-chart" aria-labelledby="usage-chart-heading">
      <div className="usage-chart__header">
        <h2 id="usage-chart-heading">Authorized and signed off, running total</h2>
        <ul className="usage-chart__key">
          {SERIES.map((series) => (
            <li key={series.key} className={`usage-chart__key-item usage-chart__key-item--${series.key}`}>
              {series.name}
            </li>
          ))}
        </ul>
      </div>
      {latest && (
        <p className="compact-hint">
          At the end of {withYear(latest.month)}: {formatDollars(latest.authorized)} authorized, {formatDollars(latest.signedOff)} signed off
          {latest.withInReview !== null && `, ${formatDollars(latest.withInReview)} with invoices in review`}. Sign-offs count in the month they happened, or when their pre-authorization was granted if later.
        </p>
      )}
      <div className="usage-chart__plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} />
            <YAxis tickFormatter={(value: number) => compact.format(value)} tickLine={false} axisLine={false} width={56} />
            <Tooltip formatter={(value) => formatDollars(value as number)} />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                dataKey={series.key}
                name={series.name}
                className={`usage-chart__line usage-chart__line--${series.key}`}
                type="linear"
                // Colored by the stylesheet's tokens, through the layer's `color`.
                stroke="currentColor"
                strokeWidth={2}
                strokeDasharray={series.key === 'withInReview' ? '6 4' : undefined}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
