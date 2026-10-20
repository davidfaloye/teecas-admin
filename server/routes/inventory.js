import { Router } from 'express';
import { col } from '../db.js';
import { requireRole, branchFilter, assertBranchAccess } from '../auth.js';
import { bad, notFound, str, num } from '../lib.js';

const r = Router();
const REASONS = ['purchase', 'usage', 'waste', 'adjustment', 'transfer'];

const withLow = (i) => ({ ...i, low: i.qty <= (i.reorderLevel || 0) });

r.get('/', async (req, res) => {
  const items = await col('inventory').find(
    { ...branchFilter(req), archived: { $ne: true } },
    { sort: { name: 1 } },
  );
  res.json({ items: items.map(withLow) });
});

r.post('/', requireRole('owner', 'manager'), async (req, res) => {
  const branchId = str(req.body?.branchId || req.user.branchId, { field: 'Branch', required: true, max: 64 });
  assertBranchAccess(req, branchId);
  if (!(await col('branches').findOne({ _id: branchId }))) throw bad('Pick a branch.');
  const name = str(req.body?.name, { field: 'Item name', required: true, max: 80 });
  const dupe = await col('inventory').findOne({ branchId, name, archived: { $ne: true } });
  if (dupe) throw bad(`${name} is already in this branch's stock list.`);
  const qty = num(req.body?.qty, { field: 'Starting quantity', min: 0, max: 1e7 }) ?? 0;
  const item = await col('inventory').insertOne({
    branchId,
    name,
    unit: str(req.body?.unit, { field: 'Unit', max: 20 }) || 'pcs',
    category: str(req.body?.category, { field: 'Group', max: 40 }),
    qty,
    reorderLevel: num(req.body?.reorderLevel, { field: 'Reorder level', min: 0, max: 1e7 }) ?? 0,
    costPerUnit: num(req.body?.costPerUnit, { field: 'Cost per unit', min: 0, max: 1e9 }) ?? 0,
  });
  if (qty) {
    await col('stockMovements').insertOne({
      inventoryId: item._id,
      branchId,
      itemName: name,
      change: qty,
      qtyAfter: qty,
      reason: 'adjustment',
      note: 'Opening stock',
      by: req.user.name,
    });
  }
  res.status(201).json({ item: withLow(item) });
});

r.patch('/:id', requireRole('owner', 'manager'), async (req, res) => {
  const item = await col('inventory').findOne({ _id: req.params.id });
  if (!item) throw notFound('Stock item not found.');
  assertBranchAccess(req, item.branchId);
  const set = {};
  const b = req.body || {};
  if ('name' in b) set.name = str(b.name, { field: 'Item name', required: true, max: 80 });
  if ('unit' in b) set.unit = str(b.unit, { field: 'Unit', max: 20 }) || 'pcs';
  if ('category' in b) set.category = str(b.category, { field: 'Group', max: 40 });
  if ('reorderLevel' in b) set.reorderLevel = num(b.reorderLevel, { field: 'Reorder level', min: 0, max: 1e7 }) ?? 0;
  if ('costPerUnit' in b) set.costPerUnit = num(b.costPerUnit, { field: 'Cost per unit', min: 0, max: 1e9 }) ?? 0;
  const updated = await col('inventory').updateOne({ _id: item._id }, { $set: set });
  res.json({ item: withLow(updated) });
});

r.delete('/:id', requireRole('owner', 'manager'), async (req, res) => {
  const item = await col('inventory').findOne({ _id: req.params.id });
  if (!item) throw notFound('Stock item not found.');
  assertBranchAccess(req, item.branchId);
  await col('inventory').updateOne({ _id: item._id }, { $set: { archived: true } });
  res.json({ ok: true });
});

// Stock in, usage, waste or a count correction. `change` is signed: +10 adds, -3 removes.
// For a stock count, send { setTo: 42, reason: 'adjustment' } instead.
r.post('/:id/movements', requireRole('owner', 'manager', 'cashier'), async (req, res) => {
  const item = await col('inventory').findOne({ _id: req.params.id });
  if (!item || item.archived) throw notFound('Stock item not found.');
  assertBranchAccess(req, item.branchId);
  const reason = REASONS.includes(req.body?.reason) ? req.body.reason : null;
  if (!reason) throw bad('Choose a reason.');
  let change;
  if (req.body?.setTo !== undefined && req.body?.setTo !== '') {
    const setTo = num(req.body.setTo, { field: 'Counted quantity', min: 0, max: 1e7, required: true });
    change = setTo - item.qty;
  } else {
    change = num(req.body?.change, { field: 'Quantity', min: -1e7, max: 1e7, required: true });
    if (change === 0) throw bad('Quantity cannot be zero.');
    if (reason === 'purchase' && change < 0) throw bad('A purchase adds stock; use a positive number.');
    if ((reason === 'waste' || reason === 'usage') && change > 0) change = -change;
  }
  const qtyAfter = Math.round((item.qty + change) * 1000) / 1000;
  if (qtyAfter < 0) throw bad(`That would leave ${qtyAfter} ${item.unit}. Check the quantity.`);
  const updated = await col('inventory').updateOne({ _id: item._id, qty: item.qty }, { $set: { qty: qtyAfter } });
  if (!updated) throw bad('Stock changed while you were editing. Try again.', 'CONFLICT');
  const movement = await col('stockMovements').insertOne({
    inventoryId: item._id,
    branchId: item.branchId,
    itemName: item.name,
    unit: item.unit,
    change,
    qtyAfter,
    reason,
    note: str(req.body?.note, { field: 'Note', max: 200 }),
    by: req.user.name,
  });
  res.status(201).json({ item: withLow(updated), movement });
});

r.get('/movements', async (req, res) => {
  const filter = { ...branchFilter(req) };
  if (req.query.inventoryId) filter.inventoryId = String(req.query.inventoryId);
  const movements = await col('stockMovements').find(filter, {
    sort: { createdAt: -1 },
    limit: Math.min(Number(req.query.limit) || 50, 300),
  });
  res.json({ movements });
});

export default r;
