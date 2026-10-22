// End-to-end checks of the API on a throwaway local store: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teecas-test-'));
process.env.DATA_FILE = path.join(dir, 'db.json');
delete process.env.MONGODB_URI;

const { connect, disconnect } = await import('../db.js');
const { createApp } = await import('../app.js');
const { seed } = await import('../seed.js');

let server;
let base;
const call = async (method, url, { body, token } = {}) => {
  const r = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
};
const login = async (email) => (await call('POST', '/api/auth/login', { body: { email, password: 'teecas-demo' } })).data.token;

before(async () => {
  await connect();
  await seed({ withSampleOrders: false });
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}`;
});

after(async () => {
  server.close();
  await disconnect();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('customer order: priced on the server, pay on delivery, WhatsApp message to the branch', async () => {
  const { data: b } = await call('GET', '/api/public/branches');
  assert.equal(b.branches.length, 3);
  const branch = b.branches[0];
  const { data: m } = await call('GET', `/api/public/menu?branchId=${branch.id}`);
  const amala = m.items.find((i) => i.name === 'Amala');
  const { status, data } = await call('POST', '/api/public/orders', {
    body: {
      branchId: branch.id,
      fulfilment: 'delivery',
      customer: { name: 'Test Customer', phone: '08031234567', address: '1 Test Street, Benin City' },
      items: [{ id: amala.id, qty: 2, price: 1 }],
    },
  });
  assert.equal(status, 201);
  assert.equal(data.order.total, amala.price * 2); // delivery fee is settled with the rider
  assert.equal(data.order.deliveryFee, 0);
  assert.equal(data.order.paymentMethod, 'pay_on_delivery');
  assert.match(data.whatsapp.url, new RegExp(`^https://wa.me/${branch.whatsapp}\\?text=`));
  assert.match(data.whatsapp.text, /Amala ~ 2/);
  assert.match(data.whatsapp.text, /delivery fee excluded/);

  const track = await call('GET', `/api/public/orders/${data.order.id}?token=${data.order.trackingToken}`);
  assert.equal(track.data.order.status, 'placed');
  const bad = await call('GET', `/api/public/orders/${data.order.id}?token=nope`);
  assert.equal(bad.status, 404);
});

test('sold-out items and paused branches are refused', async () => {
  const { data: b } = await call('GET', '/api/public/branches');
  const uniben = b.branches.find((x) => x.name === 'Uniben');
  const { data: m } = await call('GET', `/api/public/menu?branchId=${uniben.id}`);
  const turkey = m.items.find((i) => i.name === 'Big Turkey');
  assert.equal(turkey.available, false);
  const r = await call('POST', '/api/public/orders', {
    body: { branchId: uniben.id, fulfilment: 'pickup', customer: { name: 'A B', phone: '08031234567' }, items: [{ id: turkey.id, qty: 1 }] },
  });
  assert.equal(r.status, 400);
  assert.equal(r.data.code, 'ITEM_UNAVAILABLE');

  const manager = await login('uniben@teecas.online');
  await call('PATCH', `/api/branches/${uniben.id}`, { token: manager, body: { acceptingOrders: false } });
  const amala = m.items.find((i) => i.name === 'Amala');
  const closed = await call('POST', '/api/public/orders', {
    body: { branchId: uniben.id, fulfilment: 'pickup', customer: { name: 'A B', phone: '08031234567' }, items: [{ id: amala.id, qty: 1 }] },
  });
  assert.equal(closed.data.code, 'BRANCH_CLOSED');
  await call('PATCH', `/api/branches/${uniben.id}`, { token: manager, body: { acceptingOrders: true } });
});

test('staff only see and change their own branch; kitchen only cooks; delivered means paid', async () => {
  const owner = await login('owner@teecas.online');
  const kitchen = await login('kitchen.ogba@teecas.online');
  const uniben = await login('uniben@teecas.online');
  const { data } = await call('GET', '/api/orders', { token: owner });
  const order = data.orders.find((o) => o.customer.name === 'Test Customer');
  assert.ok(order);

  assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: uniben, body: { status: 'accepted' } })).status, 403);
  assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: kitchen, body: { status: 'accepted' } })).status, 403);
  assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: owner, body: { status: 'accepted' } })).data.order.status, 'accepted');
  assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: kitchen, body: { status: 'preparing' } })).data.order.status, 'preparing');
  // Delivered & paid needs the payment method, and records it.
  const noPay = await call('PATCH', `/api/orders/${order._id}/status`, { token: owner, body: { status: 'completed' } });
  assert.equal(noPay.data.code, 'PAYMENT_REQUIRED');
  assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: kitchen, body: { status: 'completed', paymentMethod: 'cash' } })).status, 403);
  const done = await call('PATCH', `/api/orders/${order._id}/status`, { token: owner, body: { status: 'completed', paymentMethod: 'transfer' } });
  assert.equal(done.data.order.status, 'completed');
  assert.equal(done.data.order.paymentStatus, 'paid');
  assert.equal(done.data.order.paidWith, 'transfer');

  const list = await call('GET', '/api/orders', { token: uniben });
  assert.ok(list.data.orders.every((o) => o.branchName === 'Uniben'));
  assert.equal((await call('GET', '/api/users', { token: kitchen })).status, 403);
});

test('stock movements keep the count right and never go negative', async () => {
  const manager = await login('ogba@teecas.online');
  const { data } = await call('GET', '/api/inventory', { token: manager });
  const item = data.items[0];
  const added = await call('POST', `/api/inventory/${item._id}/movements`, { token: manager, body: { change: 5, reason: 'purchase' } });
  assert.equal(added.data.item.qty, item.qty + 5);
  const counted = await call('POST', `/api/inventory/${item._id}/movements`, { token: manager, body: { setTo: 2, reason: 'adjustment' } });
  assert.equal(counted.data.item.qty, 2);
  const tooMuch = await call('POST', `/api/inventory/${item._id}/movements`, { token: manager, body: { change: 9, reason: 'waste' } });
  assert.equal(tooMuch.status, 400);
});

test('board flow: incoming -> accepted -> out for delivery -> delivered & paid', async () => {
  const owner = await login('owner@teecas.online');
  const { data: b } = await call('GET', '/api/public/branches');
  const branch = b.branches[0];
  const { data: m } = await call('GET', `/api/public/menu?branchId=${branch.id}`);
  const placed = await call('POST', '/api/public/orders', {
    body: { branchId: branch.id, fulfilment: 'delivery', customer: { name: 'Flow Test', phone: '08031234567', address: '2 Test Street, Benin City' }, items: [{ id: m.items[0].id, qty: 1 }] },
  });
  const id = placed.data.order.id;
  const move = (status, extra = {}) => call('PATCH', `/api/orders/${id}/status`, { token: owner, body: { status, ...extra } });
  assert.equal((await move('accepted')).data.order.status, 'accepted');
  assert.equal((await move('out_for_delivery')).data.order.status, 'out_for_delivery');
  const done = await move('completed', { paymentMethod: 'pos' });
  assert.equal(done.data.order.paidWith, 'pos');

  // Pickup goes straight from accepted to delivered & paid, never out for delivery.
  const pickup = await call('POST', '/api/public/orders', {
    body: { branchId: branch.id, fulfilment: 'pickup', customer: { name: 'Pickup Test', phone: '08031234567' }, items: [{ id: m.items[0].id, qty: 1 }] },
  });
  const pid = pickup.data.order.id;
  const pmove = (status, extra = {}) => call('PATCH', `/api/orders/${pid}/status`, { token: owner, body: { status, ...extra } });
  await pmove('accepted');
  assert.equal((await pmove('out_for_delivery')).data.code, 'BAD_TRANSITION');
  assert.equal((await pmove('completed', { paymentMethod: 'cash' })).data.order.status, 'completed');
});

test('app orders without a branch: every branch sees them, the one that accepts takes them', async () => {
  const owner = await login('owner@teecas.online');
  const ogba = await login('ogba@teecas.online');
  const uniben = await login('uniben@teecas.online');
  const { data: m } = await call('GET', '/api/public/menu');
  const item = m.items.find((i) => i.available);
  const placed = await call('POST', '/api/public/orders', {
    body: { fulfilment: 'pickup', customer: { name: 'No Branch', phone: '08031234567', address: '3 Test Street, Benin City' }, items: [{ id: item.id, qty: 3 }] },
  });
  assert.equal(placed.status, 201);
  const o = placed.data.order;
  assert.equal(o.branchId, null);
  assert.equal(o.fulfilment, 'delivery'); // no branch, so no pickup
  assert.equal(o.total, item.price * 3);
  assert.match(placed.data.whatsapp.url, /^https:\/\/wa.me\/\d+\?text=/);
  assert.doesNotMatch(placed.data.whatsapp.text, /Branch:/);

  // Every branch's staff can see it.
  for (const t of [ogba, uniben]) {
    const list = await call('GET', '/api/orders?status=placed', { token: t });
    assert.ok(list.data.orders.some((x) => x._id === o.id));
  }
  // The owner must say which branch; branch staff take it for their own branch.
  const noBranch = await call('PATCH', `/api/orders/${o.id}/status`, { token: owner, body: { status: 'accepted' } });
  assert.equal(noBranch.data.code, 'BRANCH_REQUIRED');
  const taken = await call('PATCH', `/api/orders/${o.id}/status`, { token: uniben, body: { status: 'accepted' } });
  assert.equal(taken.data.order.branchName, 'Uniben');
  // Now it belongs to Uniben only.
  assert.equal((await call('GET', `/api/orders/${o.id}`, { token: ogba })).status, 403);
  const tracking = await call('GET', `/api/public/orders/${o.id}?token=${placed.data.order.trackingToken}`);
  assert.equal(tracking.data.order.branchName, 'Uniben');

  // Owner assigns explicitly.
  const second = await call('POST', '/api/public/orders', {
    body: { customer: { name: 'Owner Pick', phone: '08031234567', address: '4 Test Street, Benin City' }, items: [{ id: item.id, qty: 1 }] },
  });
  const { data: b } = await call('GET', '/api/public/branches');
  const ring = b.branches.find((x) => x.name === 'Ring Road');
  const picked = await call('PATCH', `/api/orders/${second.data.order.id}/status`, { token: owner, body: { status: 'accepted', branchId: ring.id } });
  assert.equal(picked.data.order.branchId, ring.id);
});
