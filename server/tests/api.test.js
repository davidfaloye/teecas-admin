// End-to-end checks of the API on a throwaway local store: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teecas-test-'));
process.env.DATA_FILE = path.join(dir, 'db.json');
delete process.env.MONGODB_URI;
process.env.EMAIL_TRANSPORT = 'memory';

const { connect, disconnect } = await import('../db.js');
const { createApp } = await import('../app.js');
const { seed } = await import('../seed.js');

let server;
let base;
// ip: pretend to be a different phone (the server trusts one proxy hop, as on Render), so a test
// isn't caught by rate limits that earlier tests used up.
const call = async (method, url, { body, token, ip } = {}) => {
  const r = await fetch(base + url, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
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
      branchId: branch.id, // ignored: customers choose a branch only for pickup
      fulfilment: 'delivery',
      customer: { name: 'Test Customer', phone: '08031234567', address: '1 Test Street, Benin City' },
      items: [{ id: amala.id, qty: 2, price: 1 }],
    },
  });
  assert.equal(status, 201);
  assert.equal(data.order.branchId, null);
  assert.equal(data.order.total, amala.price * 2); // delivery fee is settled with the rider
  assert.equal(data.order.deliveryFee, 0);
  assert.equal(data.order.paymentMethod, 'pay_on_delivery');
  assert.match(data.whatsapp.url, /^https:\/\/wa.me\/\d+\?text=/);
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

  // The owner gives this delivery order to Ogba Road; after that Uniben can't touch it.
  const ogbaId = (await call('GET', '/api/public/branches')).data.branches.find((x) => x.name === 'Ogba Road').id;
  assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: kitchen, body: { status: 'accepted' } })).status, 403);
  assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: owner, body: { status: 'accepted', branchId: ogbaId } })).data.order.status, 'accepted');
  assert.equal((await call('PATCH', `/api/orders/${order._id}/status`, { token: uniben, body: { status: 'preparing' } })).status, 403);
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

  // Deleting staff: only the owner can, never an owner account, and the sign-in stops working.
  const staff = await call('POST', '/api/users', { token: owner, body: { name: 'Temp Cashier', email: 'temp@teecas.online', role: 'cashier', branchId: list.data.orders[0]?.branchId || (await call('GET', '/api/branches', { token: owner })).data.branches[0]._id, password: 'temp-pass-1' } });
  assert.equal(staff.status, 201);
  const { signToken } = await import('../auth.js');
  const { col } = await import('../db.js');
  const tempToken = signToken(await col('users').findOne({ email: 'temp@teecas.online' })); // no login call: logins are rate-limited
  assert.equal((await call('DELETE', `/api/users/${staff.data.user._id}`, { token: kitchen })).status, 403);
  const ownerId = (await call('GET', '/api/users', { token: owner })).data.users.find((u) => u.role === 'owner')._id;
  assert.equal((await call('DELETE', `/api/users/${ownerId}`, { token: owner })).status, 403);
  assert.equal((await call('DELETE', `/api/users/${staff.data.user._id}`, { token: owner })).status, 200);
  assert.equal((await call('GET', '/api/orders', { token: tempToken })).status, 401);
  assert.equal((await call('DELETE', `/api/users/${staff.data.user._id}`, { token: owner })).status, 404);
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
    body: { fulfilment: 'delivery', customer: { name: 'Flow Test', phone: '08031234567', address: '2 Test Street, Benin City' }, items: [{ id: m.items[0].id, qty: 1 }] },
  });
  const id = placed.data.order.id;
  const move = (status, extra = {}) => call('PATCH', `/api/orders/${id}/status`, { token: owner, body: { status, ...extra } });
  assert.equal((await move('accepted', { branchId: branch.id })).data.order.status, 'accepted');
  assert.equal((await move('out_for_delivery')).data.order.status, 'out_for_delivery');
  const done = await move('completed', { paymentMethod: 'pos' });
  assert.equal(done.data.order.paidWith, 'pos');

  // Pickup: only the chosen branch gets it; accepted -> ready for pickup -> collected & paid.
  const pickup = await call('POST', '/api/public/orders', {
    body: { branchId: branch.id, fulfilment: 'pickup', customer: { name: 'Pickup Test', phone: '08031234567' }, items: [{ id: m.items[0].id, qty: 1 }] },
  });
  assert.equal(pickup.data.order.branchId, branch.id);
  assert.match(pickup.data.whatsapp.text, new RegExp(`Pickup at ${branch.name}`));
  assert.match(pickup.data.whatsapp.text, /pay at pickup/);
  const pid = pickup.data.order.id;
  const { signToken } = await import('../auth.js');
  const { col } = await import('../db.js');
  const other = signToken(await col('users').findOne({ email: branch.name === 'Uniben' ? 'ogba@teecas.online' : 'uniben@teecas.online' })); // logins are rate-limited
  assert.equal((await call('GET', `/api/orders/${pid}`, { token: other })).status, 403); // other branches can't see it
  const pmove = (status, extra = {}) => call('PATCH', `/api/orders/${pid}/status`, { token: owner, body: { status, ...extra } });
  await pmove('accepted');
  assert.equal((await pmove('out_for_delivery')).data.code, 'BAD_TRANSITION');
  assert.equal((await pmove('ready')).data.order.status, 'ready');
  assert.equal((await pmove('completed', { paymentMethod: 'cash' })).data.order.status, 'completed');

  // A pickup order has to say where. (Checked directly: the public endpoint allows 8 orders a minute.)
  const { createOrder } = await import('../orders.js');
  await assert.rejects(
    createOrder({ fulfilment: 'pickup', customer: { name: 'No Branch', phone: '08031234567' }, items: [{ id: m.items[0].id, qty: 1 }] }),
    (e) => e.code === 'PICKUP_BRANCH_REQUIRED',
  );
});

test('app orders without a branch: every branch sees them, the one that accepts takes them', async () => {
  const owner = await login('owner@teecas.online');
  const ogba = await login('ogba@teecas.online');
  const uniben = await login('uniben@teecas.online');
  const { data: m } = await call('GET', '/api/public/menu');
  const item = m.items.find((i) => i.available);
  const placed = await call('POST', '/api/public/orders', {
    body: { fulfilment: 'delivery', customer: { name: 'No Branch', phone: '08031234567', address: '3 Test Street, Benin City' }, items: [{ id: item.id, qty: 3 }] },
  });
  assert.equal(placed.status, 201);
  const o = placed.data.order;
  assert.equal(o.branchId, null);
  assert.equal(o.fulfilment, 'delivery');
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

test('order history pages: skip and total', async () => {
  const owner = await login('owner@teecas.online');
  const all = await call('GET', '/api/orders?limit=500&total=1', { token: owner });
  const total = all.data.total;
  assert.ok(total >= 3);
  const p1 = await call('GET', '/api/orders?limit=2&skip=0&total=1', { token: owner });
  const p2 = await call('GET', '/api/orders?limit=2&skip=2&total=1', { token: owner });
  assert.equal(p1.data.total, total);
  assert.equal(p1.data.orders.length, 2);
  assert.deepEqual([...p1.data.orders, ...p2.data.orders].map((o) => o._id), all.data.orders.slice(0, 2 + p2.data.orders.length).map((o) => o._id));
});

test('order notifications: the app can attach and remove a push token', async () => {
  const { col } = await import('../db.js');
  const { data: m } = await call('GET', '/api/public/menu');
  const amala = m.items.find((i) => i.name === 'Amala');
  const token = 'ExponentPushToken[abcdefghij123456]';
  const { data } = await call('POST', '/api/public/orders', {
    body: {
      customer: { name: 'Push Customer', phone: '08031234567', address: '1 Test Street, Benin City' },
      items: [{ id: amala.id, qty: 1 }],
      pushToken: token,
    },
  });
  assert.equal((await col('orders').findOne({ _id: data.order.id })).pushToken, token);
  const t = data.order.trackingToken;
  assert.equal((await call('PUT', `/api/public/orders/${data.order.id}/push?token=nope`, { body: { pushToken: null } })).status, 404);
  assert.equal((await call('PUT', `/api/public/orders/${data.order.id}/push?token=${t}`, { body: { pushToken: null } })).status, 200);
  assert.equal((await col('orders').findOne({ _id: data.order.id })).pushToken, null);
  // Junk is never stored.
  await call('PUT', `/api/public/orders/${data.order.id}/push?token=${t}`, { body: { pushToken: 'http://evil' } });
  assert.equal((await col('orders').findOne({ _id: data.order.id })).pushToken, null);
});

test('only the owner can delete an order, and it is gone everywhere', async () => {
  // Created directly: the public endpoint allows 8 orders a minute and earlier tests used them.
  const { createOrder } = await import('../orders.js');
  const { data: m } = await call('GET', '/api/public/menu');
  const amala = m.items.find((i) => i.name === 'Amala');
  const { order } = await createOrder({
    customer: { name: 'Delete Me', phone: '08031234567', address: '1 Test Street, Benin City' },
    items: [{ id: amala.id, qty: 1 }],
  });
  const id = order._id;
  const t = order.trackingToken;
  const data = { order: { number: order.number } };

  // Tokens signed directly: sign-in allows 10 tries a minute and earlier tests used them.
  const { signToken } = await import('../auth.js');
  const { col } = await import('../db.js');
  const tokenFor = async (email) => signToken(await col('users').findOne({ email }));
  for (const email of ['ogba@teecas.online', 'cashier.ogba@teecas.online', 'kitchen.ogba@teecas.online']) {
    assert.equal((await call('DELETE', `/api/orders/${id}`, { token: await tokenFor(email) })).status, 403, email);
  }

  const owner = await tokenFor((await col('users').findOne({ role: 'owner' })).email);
  const del = await call('DELETE', `/api/orders/${id}`, { token: owner });
  assert.equal(del.status, 200);
  assert.equal(del.data.number, data.order.number);
  assert.equal((await call('GET', `/api/orders/${id}`, { token: owner })).status, 404);
  assert.equal((await call('GET', `/api/public/orders/${id}?token=${t}`)).status, 404);
  assert.equal((await call('DELETE', `/api/orders/${id}`, { token: owner })).status, 404);
});

test('customer accounts: sign up, order, see orders from the database, claim guest orders', async () => {
  const { data: m } = await call('GET', '/api/public/menu');
  const amala = m.items.find((i) => i.name === 'Amala');
  const details = { name: 'Ada Customer', phone: '08051112222', address: '5 Account Road, Benin City' };
  const signupBase = { ...details, email: 'Ada@Example.com' };

  // A guest order placed on this phone before signing up.
  const guest = await call('POST', '/api/public/orders', { ip: '10.0.0.7', body: { customer: details, items: [{ id: amala.id, qty: 1 }] } });
  assert.equal(guest.status, 201);

  // Sign-up checks.
  assert.equal((await call('POST', '/api/public/account/signup', { body: { ...signupBase, password: '123' } })).data.code, 'WEAK_PASSWORD');
  assert.equal((await call('POST', '/api/public/account/signup', { body: { ...details, password: 'amala-lover' } })).status, 400); // email needed
  const up = await call('POST', '/api/public/account/signup', {
    body: {
      ...signupBase,
      password: 'amala-lover',
      claim: [
        { id: guest.data.order.id, token: guest.data.order.trackingToken },
        { id: guest.data.order.id, token: 'wrong' },
      ],
    },
  });
  assert.equal(up.status, 201);
  assert.equal(up.data.claimed, 1);
  assert.equal(up.data.customer.phone, '2348051112222');
  assert.equal(up.data.customer.passwordHash, undefined);
  assert.equal(up.data.customer.email, 'ada@example.com');
  const token = up.data.token;

  // Same number again (written differently) is refused.
  const again = await call('POST', '/api/public/account/signup', { body: { ...signupBase, email: 'other@example.com', phone: '+234 805 111 2222', password: 'another-one' } });
  assert.equal(again.status, 409);
  assert.equal(again.data.code, 'PHONE_TAKEN');
  const sameEmail = await call('POST', '/api/public/account/signup', { body: { ...signupBase, phone: '08050000001', password: 'another-one' } });
  assert.equal(sameEmail.data.code, 'EMAIL_TAKEN');

  // Signed-in order is saved to the account and updates the saved address.
  const placed = await call('POST', '/api/public/orders', {
    token,
    ip: '10.0.0.7',
    body: { customer: { ...details, address: '9 New Street, Benin City' }, items: [{ id: amala.id, qty: 2 }] },
  });
  assert.equal(placed.status, 201);

  const mine = await call('GET', '/api/public/account/orders', { token });
  assert.equal(mine.status, 200);
  assert.equal(mine.data.orders.length, 2);
  assert.equal(mine.data.orders[0].id, placed.data.order.id); // newest first
  assert.ok(mine.data.orders[0].trackingToken);
  assert.equal((await call('GET', '/api/public/account/me', { token })).data.customer.address, '9 New Street, Benin City');

  // Paging.
  const page1 = await call('GET', '/api/public/account/orders?limit=1', { token });
  assert.equal(page1.data.orders.length, 1);
  assert.equal(page1.data.more, true);
  const page2 = await call('GET', `/api/public/account/orders?limit=1&before=${encodeURIComponent(page1.data.orders[0].createdAt)}`, { token });
  assert.equal(page2.data.orders[0].id, guest.data.order.id);

  // Sign in from another phone, with the email (any case), or the phone number on older accounts.
  assert.equal((await call('POST', '/api/public/account/signin', { body: { login: 'ada@example.com', password: 'nope-nope' } })).status, 401);
  const inAgain = await call('POST', '/api/public/account/signin', { body: { login: 'ADA@example.com', password: 'amala-lover' } });
  assert.equal(inAgain.status, 200);
  assert.equal((await call('POST', '/api/public/account/signin', { body: { phone: '0805 111 2222', password: 'amala-lover' } })).status, 200);
  assert.equal((await call('GET', '/api/public/account/orders', { token: inAgain.data.token })).data.orders.length, 2);

  // A customer token never opens the admin, and no token means no account data.
  assert.equal((await call('GET', '/api/orders', { token })).status, 401);
  assert.equal((await call('GET', '/api/public/account/orders')).status, 401);
  // A staff token is not a customer.
  const owner = await login('owner@teecas.online');
  assert.equal((await call('GET', '/api/public/account/me', { token: owner })).status, 401);

  // Sign-up needs only a name, email and password. Two such accounts don't clash on the phone
  // index, and the first phone number used at checkout is kept on the account.
  const lean = await call('POST', '/api/public/account/signup', { ip: '10.0.0.11', body: { name: 'Chidi', email: 'chidi@example.com', password: 'chidi-pass' } });
  assert.equal(lean.status, 201);
  assert.equal(lean.data.customer.phone, '');
  const lean2 = await call('POST', '/api/public/account/signup', { ip: '10.0.0.11', body: { name: 'Dami', email: 'dami@example.com', password: 'dami-pass' } });
  assert.equal(lean2.status, 201);
  await call('POST', '/api/public/orders', {
    token: lean.data.token,
    ip: '10.0.0.11',
    body: { customer: { name: 'Chidi', phone: '08070001111', address: '1 Lean Street, Benin City' }, items: [{ id: amala.id, qty: 1 }] },
  });
  const chidi = (await call('GET', '/api/public/account/me', { token: lean.data.token })).data.customer;
  assert.equal(chidi.phone, '2348070001111');
  assert.equal(chidi.address, '1 Lean Street, Benin City');

  // Another account can't take these orders.
  const other = await call('POST', '/api/public/account/signup', { body: { name: 'Bo', phone: '08059998888', email: 'bo@example.com', password: 'bo-password' } });
  const stolen = await call('POST', '/api/public/account/claim', {
    token: other.data.token,
    body: { orders: [{ id: placed.data.order.id, token: placed.data.order.trackingToken }] },
  });
  assert.equal(stolen.data.claimed, 0);

  // Deleting the account keeps the orders for the restaurant but unlinks them.
  assert.equal((await call('DELETE', '/api/public/account/me', { token })).status, 200);
  assert.equal((await call('GET', '/api/public/account/orders', { token })).status, 401);
  const still = await call('GET', `/api/public/orders/${placed.data.order.id}?token=${placed.data.order.trackingToken}`);
  assert.equal(still.status, 200);
});

test('forgot password: a code is emailed, wrong codes are limited, the reset signs other phones out', async () => {
  const { outbox } = await import('../email.js');
  const signup = await call('POST', '/api/public/account/signup', {
    ip: '10.0.0.8',
    body: { name: 'Chi Reset', phone: '08061234567', email: 'chi@example.com', password: 'old-password' },
  });
  assert.equal(signup.status, 201);
  const oldToken = signup.data.token;

  // Unknown accounts get the same answer, and no email.
  outbox.length = 0;
  const unknown = await call('POST', '/api/public/account/forgot', { ip: '10.0.0.8', body: { login: 'nobody@example.com' } });
  assert.equal(unknown.status, 200);
  assert.equal(outbox.length, 0);

  // By phone number: the code goes to the account's email.
  const asked = await call('POST', '/api/public/account/forgot', { ip: '10.0.0.8', body: { login: '0806 123 4567' } });
  assert.equal(asked.status, 200);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].to, 'chi@example.com');
  const code = outbox[0].text.match(/code is: (\d{6})/)[1];

  // Asking again straight away doesn't send another email (or replace the code).
  await call('POST', '/api/public/account/forgot', { ip: '10.0.0.8', body: { login: 'CHI@example.com' } });
  assert.equal(outbox.length, 1);

  const wrongCode = code === '000000' ? '111111' : '000000';
  const bad = await call('POST', '/api/public/account/reset', { ip: '10.0.0.9', body: { login: 'chi@example.com', code: wrongCode, password: 'new-password' } });
  assert.equal(bad.data.code, 'BAD_CODE');

  const ok = await call('POST', '/api/public/account/reset', { ip: '10.0.0.9', body: { login: 'chi@example.com', code, password: 'new-password' } });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);

  // The code works once; the old password and the old phone's sign-in no longer do.
  const reused = await call('POST', '/api/public/account/reset', { ip: '10.0.0.9', body: { login: 'chi@example.com', code, password: 'third-password' } });
  assert.equal(reused.data.code, 'BAD_CODE');
  assert.equal((await call('GET', '/api/public/account/me', { token: oldToken })).status, 401);
  assert.equal((await call('GET', '/api/public/account/me', { token: ok.data.token })).status, 200);
  assert.equal((await call('POST', '/api/public/account/signin', { ip: '10.0.0.9', body: { phone: '08061234567', password: 'old-password' } })).status, 401);
  assert.equal((await call('POST', '/api/public/account/signin', { ip: '10.0.0.9', body: { phone: '08061234567', password: 'new-password' } })).status, 200);

  // Five wrong codes and even the right one stops working.
  outbox.length = 0;
  const { col } = await import('../db.js');
  const chi = await col('customers').findOne({ email: 'chi@example.com' });
  await col('customers').updateOne({ _id: chi._id }, { $unset: { resetSentAt: '' } });
  await call('POST', '/api/public/account/forgot', { ip: '10.0.0.10', body: { login: 'chi@example.com' } });
  const code2 = outbox[0].text.match(/code is: (\d{6})/)[1];
  const wrong2 = code2 === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    await call('POST', '/api/public/account/reset', { ip: `10.0.1.${i}`, body: { login: 'chi@example.com', code: wrong2, password: 'x-password' } });
  }
  const locked = await call('POST', '/api/public/account/reset', { ip: '10.0.2.1', body: { login: 'chi@example.com', code: code2, password: 'x-password' } });
  assert.equal(locked.data.code, 'BAD_CODE');
});
