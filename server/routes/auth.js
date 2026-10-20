import { Router } from 'express';
import { col } from '../db.js';
import { requireAuth, signToken, publicUser, checkPassword, hashPassword } from '../auth.js';
import { HttpError, rateLimit, str, bad } from '../lib.js';

const r = Router();

r.post('/login', rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const email = str(req.body?.email, { field: 'Email', required: true, max: 120 }).toLowerCase();
  const password = str(req.body?.password, { field: 'Password', required: true, max: 200 });
  const user = await col('users').findOne({ email });
  if (!user || user.disabled || !(await checkPassword(password, user.passwordHash))) {
    throw new HttpError(401, 'That email and password do not match.', 'BAD_LOGIN');
  }
  await col('users').updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date().toISOString() } });
  res.json({ token: signToken(user), user: publicUser(user) });
});

r.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

r.post('/password', requireAuth, async (req, res) => {
  const current = str(req.body?.current, { field: 'Current password', required: true, max: 200 });
  const next = str(req.body?.next, { field: 'New password', required: true, max: 200 });
  if (next.length < 8) throw bad('Use at least 8 characters for the new password.');
  const user = await col('users').findOne({ _id: req.user._id });
  if (!(await checkPassword(current, user.passwordHash))) throw bad('Your current password is not right.');
  await col('users').updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(next) } });
  res.json({ ok: true });
});

export default r;
