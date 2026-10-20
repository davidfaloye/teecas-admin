import { Router } from 'express';
import { col } from '../db.js';
import { requireRole, assertBranchAccess } from '../auth.js';
import { notFound, forbidden, str, num, bool, normalizePhone, slugify } from '../lib.js';

const r = Router();

r.get('/', async (req, res) => {
  const filter = { archived: { $ne: true } };
  const branches = await col('branches').find(filter, { sort: { sort: 1, name: 1 } });
  res.json({ branches });
});

function fields(b, partial) {
  const out = {};
  const has = (k) => !partial || k in b;
  if (has('name')) out.name = str(b.name, { field: 'Branch name', required: true, max: 60 });
  if (has('address')) out.address = str(b.address, { field: 'Address', required: true, max: 200 });
  if (has('landmark')) out.landmark = str(b.landmark, { field: 'Landmark', max: 120 });
  if (has('whatsapp')) out.whatsapp = normalizePhone(b.whatsapp, { field: 'WhatsApp number', required: true });
  if (has('phone')) out.phone = normalizePhone(b.phone, { field: 'Phone number' });
  if (has('hours')) out.hours = str(b.hours, { field: 'Opening hours', max: 80 });
  if (has('deliveryFee')) out.deliveryFee = num(b.deliveryFee, { field: 'Delivery fee', min: 0, max: 1e6, int: true }) ?? 0;
  if (has('acceptingOrders')) out.acceptingOrders = b.acceptingOrders === undefined ? true : bool(b.acceptingOrders);
  return out;
}

r.post('/', requireRole('owner'), async (req, res) => {
  const f = fields(req.body || {}, false);
  const count = await col('branches').count({});
  const branch = await col('branches').insertOne({ ...f, slug: slugify(f.name), sort: count + 1 });
  res.status(201).json({ branch });
});

r.patch('/:id', requireRole('owner', 'manager'), async (req, res) => {
  const branch = await col('branches').findOne({ _id: req.params.id });
  if (!branch) throw notFound('Branch not found.');
  assertBranchAccess(req, branch._id);
  const body = req.body || {};
  // Managers can only open or pause online orders for their branch.
  if (req.user.role === 'manager' && Object.keys(body).some((k) => k !== 'acceptingOrders')) {
    throw forbidden('Only the owner can change branch details.');
  }
  const f = fields(body, true);
  if (f.name) f.slug = slugify(f.name);
  const updated = await col('branches').updateOne({ _id: branch._id }, { $set: f });
  res.json({ branch: updated });
});

r.delete('/:id', requireRole('owner'), async (req, res) => {
  const active = await col('branches').count({ archived: { $ne: true } });
  if (active <= 1) throw forbidden('You need at least one branch.');
  const branch = await col('branches').updateOne(
    { _id: req.params.id },
    { $set: { archived: true, acceptingOrders: false } },
  );
  if (!branch) throw notFound('Branch not found.');
  res.json({ ok: true });
});

export default r;
