// Shared helpers: errors, validation, roles, time zone.

export const TIMEZONE = process.env.RESTAURANT_TIMEZONE || 'Africa/Lagos';

export const ROLES = ['owner', 'manager', 'cashier', 'kitchen'];

export const ORDER_STATUSES = [
  'placed',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
];

// Which status can follow which. The board runs: placed (incoming) -> accepted ->
// out_for_delivery -> completed (delivered & paid). Pickup orders skip out_for_delivery.
// "preparing" and "ready" are kept for the kitchen view (currently switched off) and for
// older orders; they sit in the Accepted column.
export const NEXT_STATUS = {
  placed: ['accepted', 'cancelled'],
  accepted: ['out_for_delivery', 'completed', 'preparing', 'cancelled'],
  preparing: ['ready', 'out_for_delivery', 'completed', 'cancelled'],
  ready: ['out_for_delivery', 'completed', 'cancelled'],
  out_for_delivery: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export const PAYMENT_METHODS = ['cash', 'transfer', 'pos'];

export const STATUS_LABEL = {
  placed: 'Incoming',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  out_for_delivery: 'Out for delivery',
  completed: 'Delivered & paid',
  cancelled: 'Cancelled',
};

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const bad = (msg, code = 'BAD_REQUEST') => new HttpError(400, msg, code);
export const notFound = (what = 'Not found') => new HttpError(404, what, 'NOT_FOUND');
export const forbidden = (msg = 'You do not have access to this.') => new HttpError(403, msg, 'FORBIDDEN');

export function str(v, { field, min = 0, max = 500, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} is required.`);
    return '';
  }
  if (typeof v !== 'string' && typeof v !== 'number') throw bad(`${field} must be text.`);
  const s = String(v).trim();
  if (required && s.length < Math.max(1, min)) throw bad(`${field} is required.`);
  if (s.length > max) throw bad(`${field} is too long (max ${max} characters).`);
  return s;
}

export function num(v, { field, min = -Infinity, max = Infinity, int = false, required = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${field} is required.`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw bad(`${field} must be a number.`);
  if (int && !Number.isInteger(n)) throw bad(`${field} must be a whole number.`);
  if (n < min || n > max) throw bad(`${field} must be between ${min} and ${max}.`);
  return n;
}

export function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

// Nigerian numbers in international format without "+", e.g. 2348012345678, as wa.me expects.
export function normalizePhone(v, { field = 'Phone number', required = false } = {}) {
  const raw = str(v, { field, max: 30, required });
  if (!raw) return '';
  let d = raw.replace(/[^\d]/g, '');
  if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1);
  if (d.length < 10 || d.length > 15) throw bad(`${field} doesn't look right.`);
  return d;
}

// "YYYY-MM-DD" for a moment, in the restaurant's time zone.
export function dayKey(date, tz = TIMEZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}

export function hourOf(date, tz = TIMEZONE) {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(
      new Date(date),
    ),
  );
}

// Start of a local day ("YYYY-MM-DD") as a UTC ISO string. Lagos has no DST, but this works for
// any zone by measuring its offset at that date.
export function startOfLocalDay(key, tz = TIMEZONE) {
  const [y, m, d] = key.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const offsetMin = tzOffsetMinutes(new Date(guess), tz);
  return new Date(guess - offsetMin * 60000).toISOString();
}

function tzOffsetMinutes(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export const naira = (n) => '₦' + Math.round(n).toLocaleString('en-NG');

export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Simple fixed-window rate limiter for public endpoints.
export function rateLimit({ windowMs, max, message = 'Too many requests. Try again shortly.' }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, res, next) => {
    const key = req.ip;
    const n = (hits.get(key) || 0) + 1;
    hits.set(key, n);
    if (n > max) return res.status(429).json({ error: message, code: 'RATE_LIMITED' });
    next();
  };
}
