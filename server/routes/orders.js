import { Router } from 'express';
import { col } from '../db.js';
import { branchFilter, assertBranchAccess, requireRole } from '../auth.js';
import { changeStatus, getOrderOr404 } from '../orders.js';
import { publish } from '../events.js';
import { ORDER_STATUSES, PAYMENT_METHODS, bad, forbidden, str, startOfLocalDay, addDays } from '../lib.js';

const r = Router();

// GET /api/orders?status=placed,accepted&branchId=&from=YYYY-MM-DD&to=YYYY-MM-DD&q=&limit=
r.get('/', async (req, res) => {
  const filter = { ...branchFilter(req) };
  if (req.query.status) {
    const statuses = String(req.query.status)
      .split(',')
      .filter((s) => ORDER_STATUSES.includes(s));
    if (statuses.length) filter.status = { $in: statuses };
  }
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = startOfLocalDay(String(req.query.from));
    if (req.query.to) filter.createdAt.$lt = startOfLocalDay(addDays(String(req.query.to), 1));
  }
  const q = str(req.query.q, { field: 'Search', max: 80 });
  if (q) {
    const n = Number(q.replace(/^#/, ''));
    const rx = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    filter.$or = [{ 'customer.name': rx }, { 'customer.phone': rx }];
    if (Number.isInteger(n)) filter.$or.push({ number: n });
  }
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const orders = await col('orders').find(filter, { sort: { createdAt: -1 }, limit });
  res.json({ orders });
});

r.get('/:id', async (req, res) => {
  const order = await getOrderOr404(req.params.id);
  assertBranchAccess(req, order.branchId);
  res.json({ order });
});

r.patch('/:id/status', async (req, res) => {
  const order = await getOrderOr404(req.params.id);
  assertBranchAccess(req, order.branchId);
  const status = String(req.body?.status || '');
  if (!ORDER_STATUSES.includes(status)) throw bad('Unknown status.');
  const reason = str(req.body?.reason, { field: 'Reason', max: 200 });
  if (status === 'completed' && req.user.role === 'kitchen') throw forbidden('Only managers and cashiers can record payment.');
  const updated = await changeStatus(order, status, req.user, reason, req.body?.paymentMethod || null);
  res.json({ order: updated });
});

// Record payment collected on delivery or at pickup.
r.patch('/:id/payment', requireRole('owner', 'manager', 'cashier'), async (req, res) => {
  const order = await getOrderOr404(req.params.id);
  assertBranchAccess(req, order.branchId);
  const paymentStatus = req.body?.paymentStatus === 'paid' ? 'paid' : 'unpaid';
  const method = PAYMENT_METHODS.includes(req.body?.method) ? req.body.method : null;
  if (paymentStatus === 'paid' && !method) throw bad('Choose how the customer paid: cash, transfer or POS.');
  const updated = await col('orders').updateOne(
    { _id: order._id },
    {
      $set: {
        paymentStatus,
        paidWith: paymentStatus === 'paid' ? method : null,
        paidAt: paymentStatus === 'paid' ? new Date().toISOString() : null,
        paymentRecordedBy: req.user.name,
      },
    },
  );
  publish('order.updated', updated, updated.branchId);
  res.json({ order: updated });
});

export default r;
