import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatINR(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const num = Number(val);
  return new Intl.NumberFormat('en-IN', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(num);
}

export function formatLakhs(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const num = Number(val);
  return `₹${formatINR(num)}L`;
}

export function formatCrores(val) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const num = Number(val);
  return `₹${formatINR(num / 100, 2)} Cr`;
}

export function formatPct(val, includeSign = true) {
  if (val === null || val === undefined || isNaN(val)) return '—';
  const num = Number(val);
  const sign = includeSign && num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
}
