// Endpoints the customer ordering app uses. No sign-in.

import { Router } from 'express';
import cors from 'cors';
import { col } from '../db.js';
import { createOrder, isItemAvailable, isItemOnMenu, publicOrder, getOrderOr404, orderWhatsapp } from '../orders.js';
import { rateLimit, notFound } from '../lib.js';

const r = Router();
r.use(cors());

export function publicBranch(b) {
  return {
    id: b._id,
    name: b.name,
    slug: b.slug,
    address: b.address,
    landmark: b.landmark || '',
    phone: b.phone || b.whatsapp,
    whatsapp: b.whatsapp,
    hours: b.hours,
    deliveryFee: b.deliveryFee || 0,
    acceptingOrders: Boolean(b.acceptingOrders),
  };
}

r.get('/config', (req, res) => {
  res.json({
    name: process.env.RESTAURANT_NAME || 'Teecas Amala Express Bukka',
    currency: 'NGN',
    paymentMethods: ['pay_on_delivery'],
  });
});

r.get('/branches', async (req, res) => {
  const branches = await col('branches').find({ archived: { $ne: true } }, { sort: { sort: 1, name: 1 } });
  res.json({ branches: branches.map(publicBranch) });
});

r.get('/menu', async (req, res) => {
  const branchId = req.query.branchId ? String(req.query.branchId) : null;
  const [categories, items] = await Promise.all([
    col('categories').find({}, { sort: { sort: 1, name: 1 } }),
    col('menuItems').find({ archived: { $ne: true } }, { sort: { sort: 1, name: 1 } }),
  ]);
  res.json({
    categories: categories.map((c) => ({ id: c._id, name: c.name, subtitle: c.subtitle || '' })),
    items: items.map((m) => ({
      id: m._id,
      categoryId: m.categoryId,
      name: m.name,
      description: m.description || '',
      price: m.price,
      emoji: m.emoji || '',
      imageUrl: m.imageUrl || '',
      popular: Boolean(m.popular),
      available: branchId ? isItemAvailable(m, branchId) : isItemOnMenu(m),
    })),
  });
});

const orderLimiter = rateLimit({ windowMs: 60_000, max: 8, message: 'Too many orders from this device. Wait a minute and try again.' });

r.post('/orders', orderLimiter, async (req, res) => {
  const { order, whatsapp } = await createOrder(req.body || {});
  res.status(201).json({ order: { ...publicOrder(order), trackingToken: order.trackingToken }, whatsapp });
});

r.get('/orders/:id', async (req, res) => {
  const order = await getOrderOr404(req.params.id);
  if (!req.query.token || req.query.token !== order.trackingToken) throw notFound('Order not found.');
  const branch = order.branchId ? await col('branches').findOne({ _id: order.branchId }) : null;
  res.json({
    order: publicOrder(order),
    branch: branch ? publicBranch(branch) : null,
    whatsapp: await orderWhatsapp(order, branch),
  });
});

export default r;
