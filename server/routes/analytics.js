// Sales analytics. Orders are read for the date range and totalled here; at one restaurant's
// volume that is fast. If order history grows into the hundreds of thousands, add a nightly
// roll-up (sales by day, branch and item) and read from that instead.

import { Router } from 'express';
import { col } from '../db.js';
import { branchFilter, requireRole } from '../auth.js';
import { dayKey, hourOf, startOfLocalDay, addDays, bad } from '../lib.js';

const r = Router();

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

function emptyTotals() {
  return { orders: 0, completed: 0, cancelled: 0, open: 0, revenue: 0, openValue: 0, items: 0 };
}

function addTo(t, o) {
  t.orders++;
  if (o.status === 'completed') {
    t.completed++;
    t.revenue += o.total;
    t.items += o.items.reduce((s, i) => s + i.qty, 0);
  } else if (o.status === 'cancelled') t.cancelled++;
  else {
    t.open++;
    t.openValue += o.total;
  }
}

r.get('/', requireRole('owner', 'manager'), async (req, res) => {
  const today = dayKey(new Date());
  const to = isDay(String(req.query.to || '')) ? String(req.query.to) : today;
  const from = isDay(String(req.query.from || '')) ? String(req.query.from) : addDays(to, -13);
  if (from > to) throw bad('The start date is after the end date.');
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  if (spanDays > 366) throw bad('Pick a range of a year or less.');

  // Same-length period just before, for comparison.
  const prevFrom = addDays(from, -spanDays);
  const filter = {
    ...branchFilter(req),
    createdAt: { $gte: startOfLocalDay(prevFrom), $lt: startOfLocalDay(addDays(to, 1)) },
  };
  const [orders, branches] = await Promise.all([
    col('orders').find(filter),
    col('branches').find({}, { sort: { sort: 1 } }),
  ]);

  const totals = emptyTotals();
  const previous = emptyTotals();
  const byDay = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) byDay.set(d, { date: d, revenue: 0, orders: 0 });
  const byBranch = new Map(branches.map((b) => [b._id, { branchId: b._id, name: b.name, ...emptyTotals() }]));
  const byItem = new Map();
  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0 }));
  const byFulfilment = { delivery: 0, pickup: 0 };

  for (const o of orders) {
    const key = dayKey(o.createdAt);
    if (key < from) {
      addTo(previous, o);
      continue;
    }
    addTo(totals, o);
    const b = byBranch.get(o.branchId);
    if (b) addTo(b, o);
    if (o.status === 'cancelled') continue;
    byHour[hourOf(o.createdAt)].orders++;
    byFulfilment[o.fulfilment] = (byFulfilment[o.fulfilment] || 0) + 1;
    if (o.status !== 'completed') continue;
    const day = byDay.get(key);
    if (day) {
      day.revenue += o.total;
      day.orders++;
    }
    for (const i of o.items) {
      const it = byItem.get(i.name) || { name: i.name, qty: 0, revenue: 0 };
      it.qty += i.qty;
      it.revenue += i.lineTotal;
      byItem.set(i.name, it);
    }
  }

  const avgOrder = totals.completed ? Math.round(totals.revenue / totals.completed) : 0;
  res.json({
    range: { from, to, days: spanDays },
    totals: { ...totals, avgOrder },
    previous: { ...previous, avgOrder: previous.completed ? Math.round(previous.revenue / previous.completed) : 0 },
    byDay: [...byDay.values()],
    byBranch: [...byBranch.values()].filter((b) => b.orders > 0 || !req.query.branchId),
    topItems: [...byItem.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    byHour,
    byFulfilment,
  });
});

// Home screen: today at a glance.
r.get('/today', async (req, res) => {
  const today = dayKey(new Date());
  const scope = branchFilter(req);
  const [orders, lowStock, branches] = await Promise.all([
    col('orders').find({ ...scope, createdAt: { $gte: startOfLocalDay(today) } }, { sort: { createdAt: -1 } }),
    col('inventory').find({ ...scope, archived: { $ne: true } }),
    col('branches').find({ archived: { $ne: true } }, { sort: { sort: 1 } }),
  ]);
  const totals = emptyTotals();
  const perBranch = new Map(branches.map((b) => [b._id, { branchId: b._id, name: b.name, acceptingOrders: b.acceptingOrders, ...emptyTotals() }]));
  for (const o of orders) {
    addTo(totals, o);
    const b = perBranch.get(o.branchId);
    if (b) addTo(b, o);
  }
  const low = lowStock
    .filter((i) => i.qty <= (i.reorderLevel || 0))
    .map((i) => ({ ...i, branchName: branches.find((b) => b._id === i.branchId)?.name || '' }))
    .sort((a, b) => a.qty / (a.reorderLevel || 1) - b.qty / (b.reorderLevel || 1));
  const visibleBranches = scope.branchId ? [...perBranch.values()].filter((b) => b.branchId === scope.branchId) : [...perBranch.values()];
  res.json({
    date: today,
    totals,
    branches: visibleBranches,
    recent: orders.slice(0, 8),
    lowStock: low.slice(0, 10),
  });
});

export default r;
