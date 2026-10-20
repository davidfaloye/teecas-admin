import { Router } from 'express';
import { col } from '../db.js';
import { requireRole, assertBranchAccess } from '../auth.js';
import { bad, notFound, str, num, bool } from '../lib.js';

const r = Router();

r.get('/', async (req, res) => {
  const [categories, items] = await Promise.all([
    col('categories').find({}, { sort: { sort: 1, name: 1 } }),
    col('menuItems').find({ archived: { $ne: true } }, { sort: { sort: 1, name: 1 } }),
  ]);
  res.json({ categories, items });
});

// ---- categories (owner) ----

r.post('/categories', requireRole('owner'), async (req, res) => {
  const name = str(req.body?.name, { field: 'Category name', required: true, max: 60 });
  const count = await col('categories').count({});
  const category = await col('categories').insertOne({
    name,
    subtitle: str(req.body?.subtitle, { field: 'Subtitle', max: 80 }),
    sort: count + 1,
  });
  res.status(201).json({ category });
});

r.patch('/categories/:id', requireRole('owner'), async (req, res) => {
  const set = {};
  if ('name' in req.body) set.name = str(req.body.name, { field: 'Category name', required: true, max: 60 });
  if ('subtitle' in req.body) set.subtitle = str(req.body.subtitle, { field: 'Subtitle', max: 80 });
  if ('sort' in req.body) set.sort = num(req.body.sort, { field: 'Order', min: 0, max: 999, int: true });
  const category = await col('categories').updateOne({ _id: req.params.id }, { $set: set });
  if (!category) throw notFound('Category not found.');
  res.json({ category });
});

r.delete('/categories/:id', requireRole('owner'), async (req, res) => {
  const inUse = await col('menuItems').count({ categoryId: req.params.id, archived: { $ne: true } });
  if (inUse) throw bad('Move or remove the dishes in this category first.');
  await col('categories').deleteOne({ _id: req.params.id });
  res.json({ ok: true });
});

// ---- items (owner) ----

function itemFields(body, partial) {
  const out = {};
  const has = (k) => !partial || k in body;
  if (has('name')) out.name = str(body.name, { field: 'Dish name', required: true, max: 80 });
  if (has('categoryId')) out.categoryId = str(body.categoryId, { field: 'Category', required: true, max: 64 });
  if (has('price')) out.price = num(body.price, { field: 'Price', min: 0, max: 10_000_000, int: true, required: true });
  if (has('description')) out.description = str(body.description, { field: 'Description', max: 200 });
  if (has('emoji')) out.emoji = str(body.emoji, { field: 'Icon', max: 8 });
  if (has('imageUrl')) {
    out.imageUrl = str(body.imageUrl, { field: 'Photo link', max: 500 });
    if (out.imageUrl && !/^https:\/\//.test(out.imageUrl)) throw bad('Photo link must start with https://');
  }
  if (has('popular')) out.popular = bool(body.popular);
  if (has('isAvailable')) out.isAvailable = body.isAvailable === undefined ? true : bool(body.isAvailable);
  return out;
}

r.post('/items', requireRole('owner'), async (req, res) => {
  const fields = itemFields(req.body || {}, false);
  if (!(await col('categories').findOne({ _id: fields.categoryId }))) throw bad('Pick a category.');
  const count = await col('menuItems').count({});
  const item = await col('menuItems').insertOne({ ...fields, unavailableBranches: [], sort: count + 1 });
  res.status(201).json({ item });
});

r.patch('/items/:id', requireRole('owner'), async (req, res) => {
  const fields = itemFields(req.body || {}, true);
  const item = await col('menuItems').updateOne({ _id: req.params.id }, { $set: fields });
  if (!item) throw notFound('Dish not found.');
  res.json({ item });
});

r.delete('/items/:id', requireRole('owner'), async (req, res) => {
  const item = await col('menuItems').updateOne({ _id: req.params.id }, { $set: { archived: true } });
  if (!item) throw notFound('Dish not found.');
  res.json({ ok: true });
});

// Sold out / back on at one branch. Owners and branch managers.
r.put('/items/:id/availability', requireRole('owner', 'manager'), async (req, res) => {
  const branchId = str(req.body?.branchId, { field: 'Branch', required: true, max: 64 });
  assertBranchAccess(req, branchId);
  const available = bool(req.body?.available);
  const item = await col('menuItems').findOne({ _id: req.params.id });
  if (!item) throw notFound('Dish not found.');
  const list = new Set(item.unavailableBranches || []);
  if (available) list.delete(branchId);
  else list.add(branchId);
  const updated = await col('menuItems').updateOne({ _id: item._id }, { $set: { unavailableBranches: [...list] } });
  res.json({ item: updated });
});

export default r;
