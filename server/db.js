// Data layer with two interchangeable backends:
//  - MongoDB (production): set MONGODB_URI, e.g. a MongoDB Atlas connection string.
//  - Local file store (demo / development): used when MONGODB_URI is not set. Data lives in
//    admin/data/dev-db.json, so it survives restarts on your machine. Do not use it in
//    production: hosts like Render wipe the disk on every deploy.
//
// Both backends expose the same small interface (see `col()`), so route code never needs to
// know which one is running. Every document uses a string `_id`.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { Query } from 'mingo';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const COLLECTIONS = [
  'branches',
  'categories',
  'menuItems',
  'inventory',
  'stockMovements',
  'orders',
  'users',
  'customers',
  'counters',
];

let mode = null; // 'mongo' | 'file'
let mongoClient = null;
let mongoDb = null;
let store = null; // file mode: { [collection]: doc[] }
let dataFile = null;
let saveTimer = null;

export const newId = () => crypto.randomUUID();

export function dbMode() {
  return mode;
}

export async function connect() {
  if (mode) return mode;
  const uri = process.env.MONGODB_URI;
  if (uri) {
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    mongoDb = mongoClient.db(process.env.MONGODB_DB || 'teecas');
    mode = 'mongo';
    await ensureIndexes();
  } else {
    dataFile = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'dev-db.json');
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    store = {};
    if (fs.existsSync(dataFile)) {
      try {
        store = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      } catch {
        console.warn(`[db] Could not read ${dataFile}; starting with an empty store.`);
        store = {};
      }
    }
    for (const c of COLLECTIONS) store[c] ||= [];
    mode = 'file';
  }
  return mode;
}

export async function disconnect() {
  if (mode === 'mongo') await mongoClient.close();
  if (mode === 'file') flushNow();
  mode = null;
}

async function ensureIndexes() {
  await mongoDb.collection('users').createIndex({ email: 1 }, { unique: true });
  await mongoDb.collection('orders').createIndex({ branchId: 1, createdAt: -1 });
  await mongoDb.collection('orders').createIndex({ status: 1 });
  await mongoDb.collection('orders').createIndex({ number: 1 }, { unique: true });
  await mongoDb.collection('orders').createIndex({ customerId: 1, createdAt: -1 });
  // Phone is optional on accounts, so it is unique only where it is set. The first version of this
  // index required it on every account; swap that one out.
  const customers = mongoDb.collection('customers');
  const old = (await customers.indexes()).find((i) => i.name === 'phone_1' && !i.partialFilterExpression);
  if (old) await customers.dropIndex('phone_1');
  await customers.createIndex({ phone: 1 }, { name: 'phone_1', unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
  await mongoDb.collection('customers').createIndex({ email: 1 }, { unique: true, sparse: true });
  await mongoDb.collection('inventory').createIndex({ branchId: 1, name: 1 });
  await mongoDb.collection('stockMovements').createIndex({ inventoryId: 1, createdAt: -1 });
}

// ---------- file store helpers ----------

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushNow, 150);
}

function flushNow() {
  if (mode !== 'file' || !dataFile) return;
  clearTimeout(saveTimer);
  const tmp = dataFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, dataFile);
}

const clone = (v) => (v === undefined ? v : structuredClone(v));

function getPath(obj, p) {
  return p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, p, value) {
  const keys = p.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

function unsetPath(obj, p) {
  const keys = p.split('.');
  const parent = keys.slice(0, -1).reduce((o, k) => (o == null ? undefined : o[k]), obj);
  if (parent) delete parent[keys[keys.length - 1]];
}

// Supports the update operators this app uses: $set, $inc, $push, $pull (by equality), $unset,
// $setOnInsert.
function applyUpdate(doc, update, inserting) {
  const ops = Object.keys(update);
  if (!ops.some((k) => k.startsWith('$'))) {
    // Replacement document.
    return { ...clone(update), _id: doc._id };
  }
  for (const [op, fields] of Object.entries(update)) {
    for (const [p, v] of Object.entries(fields)) {
      if (op === '$set') setPath(doc, p, clone(v));
      else if (op === '$setOnInsert') {
        if (inserting) setPath(doc, p, clone(v));
      } else if (op === '$inc') setPath(doc, p, (getPath(doc, p) || 0) + v);
      else if (op === '$push') {
        const arr = getPath(doc, p) || [];
        if (v && typeof v === 'object' && '$each' in v) arr.push(...clone(v.$each));
        else arr.push(clone(v));
        setPath(doc, p, arr);
      } else if (op === '$pull') {
        const arr = getPath(doc, p) || [];
        setPath(
          doc,
          p,
          arr.filter((x) => JSON.stringify(x) !== JSON.stringify(v)),
        );
      } else if (op === '$unset') unsetPath(doc, p);
      else throw new Error(`Unsupported update operator ${op}`);
    }
  }
  return doc;
}

function compareBy(sort) {
  const entries = Object.entries(sort || {});
  return (a, b) => {
    for (const [k, dir] of entries) {
      const va = getPath(a, k);
      const vb = getPath(b, k);
      if (va === vb) continue;
      if (va === undefined || va === null) return -1 * dir;
      if (vb === undefined || vb === null) return 1 * dir;
      return (va < vb ? -1 : 1) * dir;
    }
    return 0;
  };
}

// Dates are stored as ISO strings in both backends, so comparisons and sorting behave the same.
function fileCollection(name) {
  const rows = () => store[name];
  const matcher = (filter) => {
    const q = new Query(filter || {});
    return (d) => q.test(d);
  };
  return {
    async find(filter = {}, { sort, limit, skip } = {}) {
      let out = rows().filter(matcher(filter));
      if (sort) out.sort(compareBy(sort));
      if (skip) out = out.slice(skip);
      if (limit) out = out.slice(0, limit);
      return clone(out);
    },
    async findOne(filter = {}) {
      return clone(rows().find(matcher(filter)) || null);
    },
    async count(filter = {}) {
      return rows().filter(matcher(filter)).length;
    },
    async insertOne(doc) {
      const now = new Date().toISOString();
      const d = { _id: newId(), createdAt: now, updatedAt: now, ...clone(doc) };
      if (rows().some((r) => r._id === d._id)) throw new Error('Duplicate _id');
      rows().push(d);
      scheduleSave();
      return clone(d);
    },
    async insertMany(docs) {
      const out = [];
      for (const doc of docs) out.push(await this.insertOne(doc));
      return out;
    },
    // Returns the updated document (or null), like findOneAndUpdate with returnDocument: 'after'.
    async updateOne(filter, update, { upsert = false } = {}) {
      const list = rows();
      const idx = list.findIndex(matcher(filter));
      const now = new Date().toISOString();
      if (idx === -1) {
        if (!upsert) return null;
        let base = { _id: newId(), createdAt: now };
        // Copy plain equality fields from the filter, as MongoDB does on upsert.
        for (const [k, v] of Object.entries(filter || {})) {
          if (!k.startsWith('$') && (v === null || typeof v !== 'object')) setPath(base, k, v);
        }
        base = applyUpdate(base, update, true);
        base.updatedAt = now;
        list.push(base);
        scheduleSave();
        return clone(base);
      }
      const updated = applyUpdate(clone(list[idx]), update, false);
      updated.updatedAt = now;
      list[idx] = updated;
      scheduleSave();
      return clone(updated);
    },
    async updateMany(filter, update) {
      const list = rows();
      const m = matcher(filter);
      let n = 0;
      const now = new Date().toISOString();
      for (let i = 0; i < list.length; i++) {
        if (m(list[i])) {
          list[i] = applyUpdate(clone(list[i]), update, false);
          list[i].updatedAt = now;
          n++;
        }
      }
      if (n) scheduleSave();
      return n;
    },
    async deleteOne(filter) {
      const list = rows();
      const idx = list.findIndex(matcher(filter));
      if (idx === -1) return false;
      list.splice(idx, 1);
      scheduleSave();
      return true;
    },
    async deleteMany(filter = {}) {
      const before = rows().length;
      store[name] = rows().filter((d) => !matcher(filter)(d));
      scheduleSave();
      return before - store[name].length;
    },
  };
}

function mongoCollection(name) {
  const c = mongoDb.collection(name);
  const withTimestamps = (update, upsert, filter = {}) => {
    const now = new Date().toISOString();
    const isOps = Object.keys(update).some((k) => k.startsWith('$'));
    if (!isOps) return { ...update, updatedAt: now };
    const u = { ...update, $set: { ...(update.$set || {}), updatedAt: now } };
    if (upsert) {
      u.$setOnInsert = { createdAt: now, ...(update.$setOnInsert || {}) };
      if (!('_id' in filter)) u.$setOnInsert._id = newId();
    }
    return u;
  };
  return {
    async find(filter = {}, { sort, limit, skip } = {}) {
      let cur = c.find(filter);
      if (sort) cur = cur.sort(sort);
      if (skip) cur = cur.skip(skip);
      if (limit) cur = cur.limit(limit);
      return cur.toArray();
    },
    async findOne(filter = {}) {
      return c.findOne(filter);
    },
    async count(filter = {}) {
      return c.countDocuments(filter);
    },
    async insertOne(doc) {
      const now = new Date().toISOString();
      const d = { _id: newId(), createdAt: now, updatedAt: now, ...doc };
      await c.insertOne(d);
      return d;
    },
    async insertMany(docs) {
      if (!docs.length) return [];
      const now = new Date().toISOString();
      const ds = docs.map((doc) => ({ _id: newId(), createdAt: now, updatedAt: now, ...doc }));
      await c.insertMany(ds);
      return ds;
    },
    async updateOne(filter, update, { upsert = false } = {}) {
      const isOps = Object.keys(update).some((k) => k.startsWith('$'));
      if (!isOps) {
        return c.findOneAndReplace(filter, withTimestamps(update), { returnDocument: 'after', upsert });
      }
      return c.findOneAndUpdate(filter, withTimestamps(update, upsert, filter), {
        returnDocument: 'after',
        upsert,
      });
    },
    async updateMany(filter, update) {
      const r = await c.updateMany(filter, withTimestamps(update));
      return r.modifiedCount;
    },
    async deleteOne(filter) {
      const r = await c.deleteOne(filter);
      return r.deletedCount > 0;
    },
    async deleteMany(filter = {}) {
      const r = await c.deleteMany(filter);
      return r.deletedCount;
    },
  };
}

export function col(name) {
  if (!mode) throw new Error('Database not connected; call connect() first.');
  if (!COLLECTIONS.includes(name)) throw new Error(`Unknown collection ${name}`);
  return mode === 'mongo' ? mongoCollection(name) : fileCollection(name);
}

// Atomic counter, used for human-friendly order numbers.
export async function nextSequence(key) {
  const doc = await col('counters').updateOne({ _id: key }, { $inc: { value: 1 } }, { upsert: true });
  return doc.value;
}

export async function resetAll() {
  for (const c of COLLECTIONS) await col(c).deleteMany({});
}
