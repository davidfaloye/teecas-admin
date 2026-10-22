// Customer accounts for the ordering app: sign up and sign in with a phone number and password,
// then see every order placed while signed in, on any phone.
//
// Staff sign-ins live in routes/auth.js and the `users` collection. Customers are a separate
// collection with their own tokens (see auth.js), so neither can be used as the other.
//
// Guests can still order without an account. Orders placed as a guest on a phone can be moved
// into the account afterwards with POST /claim, using the tracking tokens that phone kept.

import { Router } from 'express';
import cors from 'cors';
import { col } from '../db.js';
import { checkPassword, hashPassword, publicCustomer, requireCustomer, signCustomerToken } from '../auth.js';
import { publicOrder } from '../orders.js';
import { HttpError, bad, normalizePhone, num, rateLimit, str } from '../lib.js';

const r = Router();
r.use(cors());

const MIN_PASSWORD = 6;
const MAX_CLAIM = 50;
const PAGE_SIZE = 20;

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
  const phone = normalizePhone(req.body?.phone, { field: 'Phone number', required: true });
  const pw = password(req.body?.password);
  const address = str(req.body?.address, { field: 'Delivery address', max: 300 });
  if (await col('customers').findOne({ phone })) {
    throw new HttpError(409, 'An account already uses this phone number. Sign in instead.', 'PHONE_TAKEN');
  }
  let customer;
  try {
    customer = await col('customers').insertOne({
      name,
      phone,
      address,
      passwordHash: await hashPassword(pw),
      lastLoginAt: new Date().toISOString(),
    });
  } catch (e) {
    // Two sign-ups for the same number at once: the unique index stops the second.
    if (e?.code === 11000) throw new HttpError(409, 'An account already uses this phone number. Sign in instead.', 'PHONE_TAKEN');
    throw e;
  }
  const claimed = await claimOrders(customer._id, req.body?.claim);
  res.status(201).json({ token: signCustomerToken(customer), customer: publicCustomer(customer), claimed });
});

r.post('/signin', authLimiter, async (req, res) => {
  const phone = normalizePhone(req.body?.phone, { field: 'Phone number', required: true });
  const pw = str(req.body?.password, { field: 'Password', required: true, max: 200 });
  const customer = await col('customers').findOne({ phone });
  if (!customer || customer.disabled || !(await checkPassword(pw, customer.passwordHash))) {
    throw new HttpError(401, 'That phone number and password don’t match.', 'BAD_LOGIN');
  }
  await col('customers').updateOne({ _id: customer._id }, { $set: { lastLoginAt: new Date().toISOString() } });
  const claimed = await claimOrders(customer._id, req.body?.claim);
  res.json({ token: signCustomerToken(customer), customer: publicCustomer(customer), claimed });
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
  const customer = Object.keys(set).length ? await col('customers').updateOne({ _id: req.customer._id }, { $set: set }) : req.customer;
  res.json({ customer: publicCustomer(customer) });
});

r.post('/password', requireCustomer, authLimiter, async (req, res) => {
  const current = str(req.body?.current, { field: 'Current password', required: true, max: 200 });
  const next = password(req.body?.next);
  if (!(await checkPassword(current, req.customer.passwordHash))) throw bad('Your current password is not right.', 'BAD_PASSWORD');
  await col('customers').updateOne({ _id: req.customer._id }, { $set: { passwordHash: await hashPassword(next) } });
  res.json({ ok: true });
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
