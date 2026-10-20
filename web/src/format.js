export const TZ = 'Africa/Lagos';

export const naira = (n) => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');

export const compactNaira = (n) => {
  const v = Number(n) || 0;
  if (v >= 1e6) return '₦' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (v >= 1e3) return '₦' + Math.round(v / 1e3) + 'K';
  return '₦' + v;
};

export const time = (iso) =>
  new Date(iso).toLocaleTimeString('en-NG', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });

export const dateTime = (iso) =>
  new Date(iso).toLocaleString('en-NG', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const shortDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NG', { timeZone: 'UTC', day: 'numeric', month: 'short' });
};

export const weekday = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-NG', { timeZone: 'UTC', weekday: 'short' });
};

export function ago(iso, now = Date.now()) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m ago`;
  return dateTime(iso);
}

export const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const STATUS_LABEL = {
  placed: 'New',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// The main button on each order card.
export const NEXT_ACTION = {
  placed: { to: 'accepted', label: 'Accept' },
  accepted: { to: 'preparing', label: 'Start cooking' },
  preparing: { to: 'ready', label: 'Mark ready' },
  ready: (o) => (o.fulfilment === 'delivery' ? { to: 'out_for_delivery', label: 'Send out' } : { to: 'completed', label: 'Picked up' }),
  out_for_delivery: { to: 'completed', label: 'Delivered' },
};

export const nextAction = (o) => {
  const a = NEXT_ACTION[o.status];
  return typeof a === 'function' ? a(o) : a || null;
};

export const ROLE_LABEL = { owner: 'Owner', manager: 'Branch manager', cashier: 'Cashier', kitchen: 'Kitchen' };

export const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
