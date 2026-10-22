import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { col } from './db.js';
import { HttpError, forbidden } from './lib.js';

let secret = process.env.JWT_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_ENV === 'production') {
    console.warn('[auth] JWT_SECRET is not set. Sign-ins will reset every time the server restarts.');
  }
}

const TOKEN_TTL = '7d';

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compare(pw, hash || '');

export function signToken(user) {
  return jwt.sign({ sub: user._id, role: user.role, branchId: user.branchId || null }, secret, {
    expiresIn: TOKEN_TTL,
  });
}

export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

async function userFromToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, secret);
  } catch {
    return null;
  }
  const user = await col('users').findOne({ _id: payload.sub });
  if (!user || user.disabled) return null;
  return publicUser(user);
}

export async function requireAuth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const user = await userFromToken(token);
  if (!user) return next(new HttpError(401, 'Please sign in again.', 'UNAUTHENTICATED'));
  req.user = user;
  next();
}

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

// Owners see every branch (or one, if ?branchId= is given). Everyone else is pinned to their
// own branch, whatever they ask for.
export function branchFilter(req, requested = req.query.branchId) {
  if (req.user.role === 'owner') {
    return requested && requested !== 'all' ? { branchId: String(requested) } : {};
  }
  return { branchId: req.user.branchId || '__none__' };
}

export function assertBranchAccess(req, branchId) {
  if (req.user.role === 'owner') return;
  if (!branchId || req.user.branchId !== branchId) throw forbidden('That belongs to another branch.');
}

// Orders: staff see their own branch's orders plus unassigned ones, which any branch may take.
export function orderBranchFilter(req, requested = req.query.branchId) {
  if (req.user.role === 'owner') {
    return requested && requested !== 'all' ? { branchId: { $in: [String(requested), null] } } : {};
  }
  return { branchId: { $in: [req.user.branchId || '__none__', null] } };
}

export function assertOrderAccess(req, order) {
  if (!order.branchId) return;
  assertBranchAccess(req, order.branchId);
}
