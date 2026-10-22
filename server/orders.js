import crypto from 'node:crypto';
import { col, nextSequence } from './db.js';
import { publish } from './events.js';
import { orderMessage, waLink, notifyBranch } from './whatsapp.js';
import { bad, notFound, forbidden, str, num, normalizePhone, NEXT_STATUS, PAYMENT_METHODS } from './lib.js';

const MAX_LINES = 40;
const MAX_QTY = 50;

export function isItemAvailable(item, branchId) {
  return !item.archived && item.isAvailable !== false && !(item.unavailableBranches || []).includes(branchId);
}

// Creates an order from the ordering app. Prices always come from the database, never from
// the client, and payment is always pay on delivery.
export async function createOrder(input, { channel = 'app' } = {}) {
  const branchId = str(input.branchId, { field: 'Branch', required: true, max: 64 });
  const branch = await col('branches').findOne({ _id: branchId });
  if (!branch || branch.archived) throw bad('That branch was not found.', 'BRANCH_NOT_FOUND');
  if (!branch.acceptingOrders) {
    throw bad(`${branch.name} isn't taking orders right now.`, 'BRANCH_CLOSED');
  }

  const fulfilment = input.fulfilment === 'pickup' ? 'pickup' : 'delivery';
  const c = input.customer || {};
  const customer = {
    name: str(c.name, { field: 'Your name', required: true, min: 2, max: 80 }),
    phone: normalizePhone(c.phone, { field: 'Phone number', required: true }),
    address:
      fulfilment === 'delivery'
        ? str(c.address, { field: 'Delivery address', required: true, min: 5, max: 300 })
        : '',
  };
  const note = str(input.note, { field: 'Note', max: 300 });

  if (!Array.isArray(input.items) || input.items.length === 0) throw bad('Your order is empty.');
  if (input.items.length > MAX_LINES) throw bad('That order has too many lines.');

  // Merge duplicate lines.
  const qtyById = new Map();
  for (const line of input.items) {
    const id = str(line?.id, { field: 'Item', required: true, max: 64 });
    const qty = num(line?.qty, { field: 'Quantity', min: 1, max: MAX_QTY, int: true, required: true });
    qtyById.set(id, Math.min(MAX_QTY, (qtyById.get(id) || 0) + qty));
  }
  const menu = await col('menuItems').find({ _id: { $in: [...qtyById.keys()] } });
  const byId = new Map(menu.map((m) => [m._id, m]));
  const items = [];
  const unavailable = [];
  for (const [id, qty] of qtyById) {
    const m = byId.get(id);
    if (!m || !isItemAvailable(m, branchId)) {
      unavailable.push(m?.name || 'An item');
      continue;
    }
    items.push({ itemId: m._id, name: m.name, price: m.price, qty, lineTotal: m.price * qty });
  }
  if (unavailable.length) {
    const e = bad(`Sold out at ${branch.name}: ${unavailable.join(', ')}. Remove it to continue.`, 'ITEM_UNAVAILABLE');
    e.details = { unavailable };
    throw e;
  }

  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const deliveryFee = fulfilment === 'delivery' ? Number(branch.deliveryFee || 0) : 0;
  const now = new Date().toISOString();
  const number = (await nextSequence('order')) + 1000;

  const order = await col('orders').insertOne({
    number,
    branchId,
    branchName: branch.name,
    channel,
    customer,
    fulfilment,
    items,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    note,
    paymentMethod: 'pay_on_delivery',
    paymentStatus: 'unpaid',
    status: 'placed',
    statusHistory: [{ status: 'placed', at: now, by: 'customer' }],
    trackingToken: crypto.randomBytes(12).toString('hex'),
  });

  publish('order.created', order, branchId);
  // Fire and forget: optional server-side WhatsApp message to the branch.
  notifyBranch(order, branch).then((r) => {
    if (r.sent) col('orders').updateOne({ _id: order._id }, { $set: { branchNotifiedAt: new Date().toISOString() } });
  });

  const text = orderMessage(order, branch);
  return { order, whatsapp: { phone: branch.whatsapp, text, url: waLink(branch.whatsapp, text) } };
}

// Status changes from the admin. Kitchen staff only move food through the kitchen.
const KITCHEN_MOVES = new Set(['accepted>preparing', 'preparing>ready']);

// Moving an order to "completed" means delivered (or collected) and paid, so it records how
// the customer paid unless that was already recorded.
export async function changeStatus(order, nextStatus, user, reason = '', paymentMethod = null) {
  const allowed = NEXT_STATUS[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw bad(`An order that is ${order.status.replace(/_/g, ' ')} can't move to ${nextStatus.replace(/_/g, ' ')}.`, 'BAD_TRANSITION');
  }
  if (nextStatus === 'out_for_delivery' && order.fulfilment !== 'delivery') {
    throw bad('Pickup orders are marked delivered & paid when the customer collects them.', 'BAD_TRANSITION');
  }
  if (user.role === 'kitchen' && !KITCHEN_MOVES.has(`${order.status}>${nextStatus}`)) {
    throw forbidden('Kitchen accounts can only move orders to preparing and ready.');
  }
  if (nextStatus === 'cancelled' && !reason) throw bad('Give a reason for cancelling.');
  const at = new Date().toISOString();
  const set = { status: nextStatus };
  if (nextStatus === 'completed') {
    set.completedAt = at;
    if (order.paymentStatus !== 'paid') {
      if (!PAYMENT_METHODS.includes(paymentMethod)) {
        throw bad('Choose how the customer paid: cash, transfer or POS.', 'PAYMENT_REQUIRED');
      }
      Object.assign(set, { paymentStatus: 'paid', paidWith: paymentMethod, paidAt: at, paymentRecordedBy: user.name });
    }
  }
  if (nextStatus === 'cancelled') set.cancelReason = reason;
  const updated = await col('orders').updateOne(
    { _id: order._id, status: order.status },
    { $set: set, $push: { statusHistory: { status: nextStatus, at, by: user.name, ...(reason ? { reason } : {}) } } },
  );
  if (!updated) throw bad('Someone else just updated this order. Refresh and try again.', 'CONFLICT');
  publish('order.updated', updated, updated.branchId);
  return updated;
}

export async function getOrderOr404(id) {
  const order = await col('orders').findOne({ _id: String(id) });
  if (!order) throw notFound('Order not found.');
  return order;
}

// What the customer sees when tracking an order.
export function publicOrder(o) {
  return {
    id: o._id,
    number: o.number,
    branchId: o.branchId,
    branchName: o.branchName,
    status: o.status,
    statusHistory: o.statusHistory.map(({ status, at }) => ({ status, at })),
    fulfilment: o.fulfilment,
    items: o.items.map(({ name, qty, price, lineTotal }) => ({ name, qty, price, lineTotal })),
    subtotal: o.subtotal,
    deliveryFee: o.deliveryFee,
    total: o.total,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    customer: { name: o.customer.name, address: o.customer.address },
    cancelReason: o.cancelReason,
    createdAt: o.createdAt,
  };
}
