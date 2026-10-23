// Customer accounts for the ordering app: sign up with a name, email and password, sign in with
// the email, then see every order placed while signed in, on any phone. Phone number and address
// are asked for at checkout, not at sign-up. (Older accounts that were made with a phone number
// can still sign in with it.)
// A forgotten password is reset with a 6-digit code sent to the account's email.
//
// Staff sign-ins live in routes/auth.js and the `users` collection. Customers are a separate
// collection with their own tokens (see auth.js), so neither can be used as the other.
//
// Guests can still order without an account. Orders placed as a guest on a phone can be moved
// into the account afterwards with POST /claim, using the tracking tokens that phone kept.

import crypto from 'node:crypto';
import { Router } from 'express';
import cors from 'cors';
import { col } from '../db.js';
import { checkPassword, hashPassword, publicCustomer, requireCustomer, signCustomerToken } from '../auth.js';
import { publicOrder } from '../orders.js';
import { resetCodeEmail, sendEmail } from '../email.js';
import { HttpError, bad, normalizePhone, num, rateLimit, str } from '../lib.js';

const r = Router();
r.use(cors());

const MIN_PASSWORD = 6;
const MAX_CLAIM = 50;
const PAGE_SIZE = 20;
const RESET_MINUTES = 15;
const RESET_TRIES = 5;
const RESEND_AFTER_MS = 60_000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function email(v, { required = false } = {}) {
  const e = str(v, { field: 'Email', required, max: 120 }).toLowerCase();
  if (e && !EMAIL_RE.test(e)) throw bad('That email doesn’t look right.', 'BAD_EMAIL');
  return e;
}

async function assertEmailFree(e, exceptId = null) {
  const other = await col('customers').findOne({ email: e });
  if (other && other._id !== exceptId) {
    throw new HttpError(409, 'An account already uses this email. Sign in instead.', 'EMAIL_TAKEN');
  }
}

// Phone number or email, as the customer typed it.
async function findByLogin(v, field = 'Phone number or email') {
  const login = str(v, { field, required: true, max: 120 });
  if (login.includes('@')) return col('customers').findOne({ email: email(login) });
  return col('customers').findOne({ phone: normalizePhone(login, { field: 'Phone number' }) });
}

const hashCode = (customerId, code) => crypto.createHash('sha256').update(`${customerId}:${code}`).digest('hex');

function sameHash(a, b) {
  const x = Buffer.from(String(a || ''), 'hex');
  const y = Buffer.from(String(b || ''), 'hex');
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

const RESET_FIELDS = { resetCodeHash: '', resetExpiresAt: '', resetTries: '', resetSentAt: '' };

function password(v) {
  const pw = str(v, { field: 'Password', required: true, max: 200 });
  if (pw.length < MIN_PASSWORD) throw bad(`Use at least ${MIN_PASSWORD} characters for your password.`, 'WEAK_PASSWORD');
  return pw;
}

// What the app gets for one of the customer's own orders: the public order plus the tracking
// token, so the phone can open live tracking and turn notifications on for it.
const accountOrder = (o) => ({ ...publicOrder(o), trackingToken: o.trackingToken });

// Moves guest orders into the account. Only orders whose tracking token matches (proof they were
// placed on this phone) and that don't already belong to an account.
async function claimOrders(customerId, list) {
  if (!Array.isArray(list) || !list.length) return 0;
  let n = 0;
  for (const x of list.slice(0, MAX_CLAIM)) {
    const id = typeof x?.id === 'string' ? x.id.slice(0, 64) : '';
    const token = typeof x?.token === 'string' ? x.token.slice(0, 64) : '';
    if (!id || !token) continue;
    const updated = await col('orders').updateOne(
      { _id: id, trackingToken: token, customerId: null },
      { $set: { customerId } },
    );
    if (updated) n++;
  }
  return n;
}

const authLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'Too many tries. Wait a minute and try again.' });

r.post('/signup', authLimiter, async (req, res) => {
  const name = str(req.body?.name, { field: 'Your name', required: true, min: 2, max: 80 });
  const mail = email(req.body?.email, { required: true });
  const pw = password(req.body?.password);
  // Optional: older app versions still send these.
  const phone = normalizePhone(req.body?.phone, { field: 'Phone number' });
  const address = str(req.body?.address, { field: 'Delivery address', max: 300 });
  await assertEmailFree(mail);
  if (phone && (await col('customers').findOne({ phone }))) {
    throw new HttpError(409, 'An account already uses this phone number. Sign in instead.', 'PHONE_TAKEN');
  }
  const doc = { name, email: mail, address, passwordHash: await hashPassword(pw), lastLoginAt: new Date().toISOString() };
  if (phone) doc.phone = phone; // left out, not '', so the unique phone index ignores it
  let customer;
  try {
    customer = await col('customers').insertOne(doc);
  } catch (e) {
    // Two sign-ups for the same email or number at once: the unique indexes stop the second.
    if (e?.code === 11000) {
      if (e?.keyPattern?.phone) throw new HttpError(409, 'An account already uses this phone number. Sign in instead.', 'PHONE_TAKEN');
      throw new HttpError(409, 'An account already uses this email. Sign in instead.', 'EMAIL_TAKEN');
    }
    throw e;
  }
  const claimed = await claimOrders(customer._id, req.body?.claim);
  res.status(201).json({ token: signCustomerToken(customer), customer: publicCustomer(customer), claimed });
});

// login: the email (or, for older accounts, the phone number). Older app versions send `phone`.
r.post('/signin', authLimiter, async (req, res) => {
  const pw = str(req.body?.password, { field: 'Password', required: true, max: 200 });
  const customer = await findByLogin(req.body?.login ?? req.body?.phone, 'Email');
  if (!customer || customer.disabled || !(await checkPassword(pw, customer.passwordHash))) {
    throw new HttpError(401, 'That email and password don’t match.', 'BAD_LOGIN');
  }
  await col('customers').updateOne({ _id: customer._id }, { $set: { lastLoginAt: new Date().toISOString() } });
  const claimed = await claimOrders(customer._id, req.body?.claim);
  res.json({ token: signCustomerToken(customer), customer: publicCustomer(customer), claimed });
});

// Forgot password, step 1: email a 6-digit code to the account. The answer is the same whether
// or not the account exists or has an email, so this can't be used to find out who has one.
r.post('/forgot', authLimiter, async (req, res) => {
  const customer = await findByLogin(req.body?.login);
  const now = Date.now();
  const recentlySent = customer?.resetSentAt && now - Date.parse(customer.resetSentAt) < RESEND_AFTER_MS;
  if (customer?.email && !customer.disabled && !recentlySent) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await col('customers').updateOne(
      { _id: customer._id },
      {
        $set: {
          resetCodeHash: hashCode(customer._id, code),
          resetExpiresAt: new Date(now + RESET_MINUTES * 60_000).toISOString(),
          resetTries: 0,
          resetSentAt: new Date(now).toISOString(),
        },
      },
    );
    await sendEmail({ to: customer.email, ...resetCodeEmail({ name: customer.name, code, minutes: RESET_MINUTES }) });
  }
  res.json({ ok: true, minutes: RESET_MINUTES });
});

// Forgot password, step 2: the code from the email and a new password. Signs the customer in
// on this phone and out everywhere else.
r.post('/reset', authLimiter, async (req, res) => {
  const wrong = () => bad('That code isn’t right or has run out. Check the email, or ask for a new code.', 'BAD_CODE');
  const code = str(req.body?.code, { field: 'Code', required: true, max: 12 }).replace(/\s/g, '');
  const pw = password(req.body?.password);
  const customer = await findByLogin(req.body?.login);
  if (!customer?.resetCodeHash || customer.disabled) throw wrong();
  if (Date.parse(customer.resetExpiresAt) < Date.now() || (customer.resetTries || 0) >= RESET_TRIES) {
    await col('customers').updateOne({ _id: customer._id }, { $unset: RESET_FIELDS });
    throw wrong();
  }
  if (!/^\d{6}$/.test(code) || !sameHash(hashCode(customer._id, code), customer.resetCodeHash)) {
    await col('customers').updateOne({ _id: customer._id }, { $inc: { resetTries: 1 } });
    throw wrong();
  }
  const updated = await col('customers').updateOne(
    { _id: customer._id },
    {
      $set: { passwordHash: await hashPassword(pw), passwordChangedAt: new Date().toISOString(), lastLoginAt: new Date().toISOString() },
      $inc: { passwordVersion: 1 },
      $unset: RESET_FIELDS,
    },
  );
  const claimed = await claimOrders(customer._id, req.body?.claim);
  res.json({ token: signCustomerToken(updated), customer: publicCustomer(updated), claimed });
});

// Everything below needs a signed-in customer.

r.get('/me', requireCustomer, (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ customer: publicCustomer(req.customer) });
});

r.put('/me', requireCustomer, async (req, res) => {
  const set = {};
  if (req.body?.name !== undefined) set.name = str(req.body.name, { field: 'Your name', required: true, min: 2, max: 80 });
  if (req.body?.address !== undefined) set.address = str(req.body.address, { field: 'Delivery address', max: 300 });
  if (req.body?.email !== undefined) {
    set.email = email(req.body.email, { required: true });
    await assertEmailFree(set.email, req.customer._id);
  }
  const customer = Object.keys(set).length ? await col('customers').updateOne({ _id: req.customer._id }, { $set: set }) : req.customer;
  res.json({ customer: publicCustomer(customer) });
});

r.post('/password', requireCustomer, authLimiter, async (req, res) => {
  const current = str(req.body?.current, { field: 'Current password', required: true, max: 200 });
  const next = password(req.body?.next);
  if (!(await checkPassword(current, req.customer.passwordHash))) throw bad('Your current password is not right.', 'BAD_PASSWORD');
  const customer = await col('customers').updateOne(
    { _id: req.customer._id },
    { $set: { passwordHash: await hashPassword(next), passwordChangedAt: new Date().toISOString() }, $inc: { passwordVersion: 1 } },
  );
  // Other phones are signed out; this one gets a fresh token.
  res.json({ ok: true, token: signCustomerToken(customer), customer: publicCustomer(customer) });
});

// Deleting an account removes the sign-in and the saved details. The orders stay on the
// restaurant's books (sales, history) but are no longer linked to anyone.
r.delete('/me', requireCustomer, async (req, res) => {
  await col('orders').updateMany({ customerId: req.customer._id }, { $set: { customerId: null } });
  await col('customers').deleteOne({ _id: req.customer._id });
  res.json({ ok: true });
});

// The customer's orders, newest first. ?before=<createdAt of the last order shown> pages back.
r.get('/orders', requireCustomer, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const limit = num(req.query.limit, { field: 'limit', min: 1, max: 50, int: true }) || PAGE_SIZE;
  const filter = { customerId: req.customer._id };
  if (req.query.before) filter.createdAt = { $lt: str(req.query.before, { field: 'before', max: 40 }) };
  const orders = await col('orders').find(filter, { sort: { createdAt: -1 }, limit: limit + 1 });
  res.json({ orders: orders.slice(0, limit).map(accountOrder), more: orders.length > limit });
});

r.post('/claim', requireCustomer, async (req, res) => {
  res.json({ claimed: await claimOrders(req.customer._id, req.body?.orders) });
});

export default r;
