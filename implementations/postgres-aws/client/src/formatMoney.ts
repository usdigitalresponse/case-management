const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const usdRate = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

// A rate per mile can have a third decimal place, such as $0.655.
export function formatRate(rate: string | number | null | undefined): string {
  return rate === null || rate === undefined || rate === '' ? '—' : usdRate.format(Number(rate));
}

export function formatMoney(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === '') {
    return '—';
  }
  return usd.format(Number(amount));
}
