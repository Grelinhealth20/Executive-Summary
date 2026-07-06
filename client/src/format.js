export const money = (n) =>
  '$' +
  Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const moneyShort = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
  if (Math.abs(v) >= 1_000) return '$' + (v / 1_000).toFixed(1) + 'K';
  return money(v);
};

export const int = (n) => Number(n || 0).toLocaleString('en-US');

export const pct = (n) => Number(n || 0).toFixed(1) + '%';
