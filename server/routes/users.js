import { Router } from 'express';
import { col } from '../db.js';
import { requireRole, hashPassword, publicUser } from '../auth.js';
import { ROLES, bad, notFound, forbidden, str, bool } from '../lib.js';

const r = Router();
r.use(requireRole('owner'));

r.get('/', async (req, res) => {
  const users = await col('users').find({}, { sort: { role: 1, name: 1 } });
  res.json({ users: users.map(publicUser) });
});

async function checkBranch(role, branchId) {
  if (role === 'owner') return null;
  if (!branchId) throw bad('Staff other than owners need a branch.');
  if (!(await col('branches').findOne({ _id: branchId }))) throw bad('Pick a branch.');
  return branchId;
}

r.post('/', async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, { field: 'Name', required: true, max: 80 });
  const email = str(b.email, { field: 'Email', required: true, max: 120 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Enter a valid email address.');
  const role = ROLES.includes(b.role) ? b.role : null;
  if (!role) throw bad('Choose a role.');
  const password = str(b.password, { field: 'Password', required: true, max: 200 });
  if (password.length < 8) throw bad('Use at least 8 characters for the password.');
  if (await col('users').findOne({ email })) throw bad('Someone already uses that email.');
  const user = await col('users').insertOne({
    name,
    email,
    role,
    branchId: await checkBranch(role, b.branchId),
    passwordHash: await hashPassword(password),
  });
  res.status(201).json({ user: publicUser(user) });
});

r.patch('/:id', async (req, res) => {
  const user = await col('users').findOne({ _id: req.params.id });
  if (!user) throw notFound('Staff member not found.');
  const b = req.body || {};
  const set = {};
  if ('name' in b) set.name = str(b.name, { field: 'Name', required: true, max: 80 });
  if ('role' in b) {
    if (!ROLES.includes(b.role)) throw bad('Choose a role.');
    set.role = b.role;
  }
  const role = set.role || user.role;
  if ('branchId' in b || 'role' in b) set.branchId = await checkBranch(role, 'branchId' in b ? b.branchId : user.branchId);
  if ('disabled' in b) set.disabled = bool(b.disabled);
  if (b.password) {
    const pw = str(b.password, { field: 'Password', max: 200 });
    if (pw.length < 8) throw bad('Use at least 8 characters for the password.');
    set.passwordHash = await hashPassword(pw);
  }
  // Never lock the restaurant out: keep at least one active owner.
  if (user.role === 'owner' && (set.role && set.role !== 'owner' || set.disabled)) {
    const owners = await col('users').count({ role: 'owner', disabled: { $ne: true } });
    if (owners <= 1) throw forbidden('Add another owner before changing this one.');
  }
  const updated = await col('users').updateOne({ _id: user._id }, { $set: set });
  res.json({ user: publicUser(updated) });
});

// Removes a staff member's sign-in for good. Owners can't be deleted here, so the restaurant is
// never left without one. Past orders and stock records keep the name they were saved with.
r.delete('/:id', async (req, res) => {
  const user = await col('users').findOne({ _id: req.params.id });
  if (!user) throw notFound('Staff member not found.');
  if (user.role === 'owner') throw forbidden('Owners can’t be deleted. Change their role first if they’re leaving.');
  await col('users').deleteOne({ _id: user._id });
  res.json({ ok: true });
});

export default r;
