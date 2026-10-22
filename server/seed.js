// Demo data: three branches, the Teecas menu, dummy stock for each branch, staff accounts and
// five weeks of sample orders so the analytics screens have something to show.
//
//   npm run seed            add demo data if the database is empty
//   npm run seed -- --reset wipe everything and load fresh demo data
//
// Branch names, WhatsApp numbers and stock levels are placeholders: change them in the admin.

import 'dotenv/config';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { connect, disconnect, col, resetAll } from './db.js';
import { hashPassword } from './auth.js';
import { dayKey, addDays, startOfLocalDay, slugify } from './lib.js';

const WHATSAPP = process.env.SEED_WHATSAPP || '2348088524502';

const BRANCHES = [
  {
    key: 'ogba',
    name: 'Ogba Road',
    address: '144 Airport/Ogba Road, after ADP Junction, Benin City',
    landmark: 'Adjacent DVD filling station',
    hours: 'Mon–Sat 8am – 9pm, Sun 12pm – 8pm',
    deliveryFee: 1000,
  },
  {
    key: 'uniben',
    name: 'Uniben',
    address: 'Food truck, University of Benin, Ugbowo campus',
    landmark: 'Near the main gate',
    hours: 'Mon–Fri 9am – 7pm',
    deliveryFee: 500,
  },
  {
    key: 'ringroad',
    name: 'Ring Road',
    address: 'Sample address — King’s Square, Ring Road, Benin City',
    landmark: 'Placeholder branch, rename in Branches',
    hours: 'Daily 9am – 10pm',
    deliveryFee: 1000,
  },
];

const CATEGORIES = [
  { key: 'amala', name: 'Amala Cuisine', subtitle: 'Swallow · made fresh to order' },
  { key: 'soups', name: 'Soups', subtitle: 'Rich · slow-simmered' },
  { key: 'main', name: 'Main Course', subtitle: 'Rice, plantain & sides' },
  { key: 'protein', name: 'Protein', subtitle: 'Meat & fish · sold per portion' },
];

// Dishes and prices from teecas.online. Descriptions and icons are demo copy.
const MENU = [
  ['amala', 'Amala', 1075, '🟤', 'Soft, smooth yam-flour swallow', true],
  ['amala', 'Plantain Amala', 1075, '🟫', 'Unripe plantain swallow, lighter on the stomach'],
  ['amala', 'Poundo', 1075, '⚪', 'Pounded-yam style swallow'],
  ['amala', 'Eba', 860, '🟡', 'Garri swallow, firm and filling'],
  ['soups', 'Egusi', 1700, '🥣', 'Melon seed soup with leafy greens', true],
  ['soups', 'Okro', 1700, '🥬', 'Draw soup with fresh okro'],
  ['soups', 'Vegetable (Efo Riro)', 1700, '🥗', 'Spinach stew with pepper and locust beans'],
  ['main', 'Jollof Rice', 2150, '🍛', 'Smoky party-style jollof', true],
  ['main', 'Fried Rice', 2150, '🍚', 'Mixed vegetables and liver'],
  ['main', 'Asun Rice', 2700, '🌶️', 'Spicy rice with peppered goat meat'],
  ['main', 'Ofada Rice', 2150, '🍙', 'Local brown rice'],
  ['main', 'Ofada Sauce', 2500, '🫕', 'Green pepper sauce with assorted meat'],
  ['main', 'Chinese Rice', 2700, '🥢', 'Stir-fried rice with vegetables'],
  ['main', 'Rice & Beans', 2150, '🫘', 'Served with stew'],
  ['main', 'White Rice', 1300, '🍚', 'Plain boiled rice'],
  ['main', 'Oil Beans', 1075, '🫘', 'Ukpaka-style oil beans'],
  ['main', 'Spaghetti', 2000, '🍝', 'Jollof spaghetti'],
  ['main', 'Moi Moi', 1075, '🧁', 'Steamed bean pudding'],
  ['main', 'Dodo (Plantain)', 550, '🍌', 'Fried ripe plantain', true],
  ['main', 'Salad', 1075, '🥗', 'Fresh coleslaw-style salad'],
  ['protein', 'Assorted', 1075, '🍖', 'Mixed offal, peppered'],
  ['protein', 'Ponmo', 1075, '🟠', 'Soft cow skin'],
  ['protein', 'Goatmeat', 3800, '🐐', 'Tender goat meat', true],
  ['protein', 'Cowleg', 2700, '🦴', 'Slow-cooked cow leg'],
  ['protein', 'Big Turkey', 7000, '🦃', 'Large fried turkey'],
  ['protein', 'Medium Turkey', 5000, '🦃', 'Medium fried turkey'],
  ['protein', 'Cow Head', 1650, '🐄', 'Peppered cow head'],
  ['protein', 'Chicken', 4500, '🍗', 'Fried chicken', true],
  ['protein', 'Meluza Fish', 4300, '🐟', 'Fried hake'],
  ['protein', 'Titus Fish', 4300, '🐟', 'Fried mackerel'],
  ['protein', 'Boiled Titus', 4300, '🐠', 'Mackerel cooked in the soup'],
  ['protein', 'Dryfish', 2700, '🐡', 'Smoked dry fish'],
  ['protein', 'Panla Fish', 1300, '🐟', 'Smoked hake'],
  ['protein', 'Fried Beef', 1650, '🥩', 'Fried beef'],
];

// Dummy kitchen stock: [name, unit, group, typical qty, reorder level, cost per unit (₦)]
const STOCK = [
  ['Elubo (yam flour)', 'bags (10 kg)', 'Dry goods', 14, 4, 18000],
  ['Plantain flour', 'bags (5 kg)', 'Dry goods', 8, 3, 9500],
  ['Poundo yam flour', 'bags (5 kg)', 'Dry goods', 9, 3, 11000],
  ['Garri', 'bags (10 kg)', 'Dry goods', 6, 3, 9000],
  ['Rice', 'bags (50 kg)', 'Dry goods', 7, 2, 78000],
  ['Ofada rice', 'bags (25 kg)', 'Dry goods', 3, 1, 52000],
  ['Beans', 'bags (25 kg)', 'Dry goods', 4, 1, 38000],
  ['Spaghetti', 'cartons', 'Dry goods', 10, 3, 17500],
  ['Egusi (ground)', 'kg', 'Soup', 18, 6, 4200],
  ['Okro', 'kg', 'Soup', 12, 5, 1500],
  ['Ugu / spinach', 'bundles', 'Soup', 30, 10, 500],
  ['Palm oil', 'jerrycans (25 L)', 'Oils', 3, 1, 42000],
  ['Vegetable oil', 'jerrycans (25 L)', 'Oils', 4, 1, 48000],
  ['Tomato paste', 'cartons', 'Soup', 5, 2, 21000],
  ['Pepper mix (tatashe, rodo)', 'baskets', 'Soup', 6, 2, 15000],
  ['Onions', 'bags', 'Soup', 3, 1, 35000],
  ['Goat meat', 'kg', 'Protein', 25, 8, 6500],
  ['Beef', 'kg', 'Protein', 40, 12, 5200],
  ['Turkey', 'kg', 'Protein', 20, 8, 5800],
  ['Chicken', 'kg', 'Protein', 22, 8, 4800],
  ['Cow leg', 'pcs', 'Protein', 16, 5, 2500],
  ['Ponmo', 'pcs', 'Protein', 40, 12, 600],
  ['Titus fish', 'cartons', 'Protein', 3, 1, 62000],
  ['Hake (meluza)', 'cartons', 'Protein', 2, 1, 58000],
  ['Dry fish', 'kg', 'Protein', 6, 2, 9000],
  ['Ripe plantain', 'bunches', 'Produce', 9, 4, 6000],
  ['Takeaway packs', 'packs of 50', 'Packaging', 12, 5, 3500],
  ['Nylon bags', 'packs', 'Packaging', 8, 3, 1500],
];

const FIRST = ['Osas', 'Efosa', 'Ivie', 'Osaro', 'Ese', 'Chioma', 'Tunde', 'Amaka', 'Kingsley', 'Blessing', 'Uyi', 'Nosa', 'Funke', 'Emeka', 'Grace', 'Ifeoma', 'Bola', 'Precious', 'Daniel', 'Joy'];
const LAST = ['Igbinedion', 'Osagie', 'Okoro', 'Adeyemi', 'Eghosa', 'Obaseki', 'Nwosu', 'Ehigiator', 'Okafor', 'Aghedo', 'Bello', 'Ogbemudia'];
const STREETS = ['Sapele Road', 'Ugbowo-Lagos Road', 'Airport Road', 'Ekehuan Road', 'Akpakpava Street', 'Siluko Road', 'Upper Mission', 'Uselu-Lagos Road', 'Ihama Road', 'Okhoro Road'];

// Small seeded random generator so the demo data is the same every time.
function rng(seedStr) {
  let h = 2166136261;
  for (const ch of seedStr) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seed({ withSampleOrders = true, days = 35 } = {}) {
  const rand = rng('teecas-demo');
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));

  // Branches
  const branches = [];
  for (const [i, b] of BRANCHES.entries()) {
    const { key, ...rest } = b;
    branches.push({
      key,
      ...(await col('branches').insertOne({
        ...rest,
        slug: slugify(b.name),
        whatsapp: WHATSAPP,
        phone: WHATSAPP,
        acceptingOrders: true,
        sort: i + 1,
      })),
    });
  }

  // Menu
  const cats = {};
  for (const [i, c] of CATEGORIES.entries()) {
    cats[c.key] = await col('categories').insertOne({ name: c.name, subtitle: c.subtitle, sort: i + 1 });
  }
  const items = [];
  for (const [i, [cat, name, price, emoji, description, popular]] of MENU.entries()) {
    items.push(
      await col('menuItems').insertOne({
        categoryId: cats[cat]._id,
        name,
        price,
        emoji,
        description,
        popular: Boolean(popular),
        isAvailable: true,
        // A couple of sold-out items so the "sold out at this branch" feature is visible.
        unavailableBranches:
          name === 'Big Turkey' ? [branches[1]._id] : name === 'Ofada Sauce' ? [branches[2]._id] : [],
        sort: i + 1,
      }),
    );
  }

  // Stock per branch (Uniben is a food truck, so it carries less)
  for (const b of branches) {
    const scale = b.key === 'uniben' ? 0.5 : b.key === 'ringroad' ? 0.8 : 1;
    for (const [name, unit, category, typical, reorder, cost] of STOCK) {
      const reorderLevel = Math.max(1, Math.round(reorder * scale));
      // Roughly 1 in 6 items is at or under its reorder level.
      const low = rand() < 0.17;
      const qty = low ? between(0, reorderLevel) : Math.max(reorderLevel + 1, Math.round(typical * scale * (0.7 + rand() * 0.8)));
      const inv = await col('inventory').insertOne({ branchId: b._id, name, unit, category, qty, reorderLevel, costPerUnit: cost });
      await col('stockMovements').insertOne({
        inventoryId: inv._id,
        branchId: b._id,
        itemName: name,
        unit,
        change: qty,
        qtyAfter: qty,
        reason: 'adjustment',
        note: 'Opening stock (demo)',
        by: 'Setup',
      });
    }
  }

  // Staff
  const ownerEmail = process.env.SEED_OWNER_EMAIL || 'owner@teecas.online';
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || 'teecas-demo';
  const staffPassword = await hashPassword(process.env.SEED_STAFF_PASSWORD || 'teecas-demo');
  await col('users').insertOne({ name: 'Teecas Owner', email: ownerEmail, role: 'owner', branchId: null, passwordHash: await hashPassword(ownerPassword) });
  for (const b of branches) {
    await col('users').insertOne({ name: `${b.name} Manager`, email: `${b.key}@teecas.online`, role: 'manager', branchId: b._id, passwordHash: staffPassword });
  }
  await col('users').insertOne({ name: 'Ogba Kitchen', email: 'kitchen.ogba@teecas.online', role: 'kitchen', branchId: branches[0]._id, passwordHash: staffPassword });
  await col('users').insertOne({ name: 'Ogba Cashier', email: 'cashier.ogba@teecas.online', role: 'cashier', branchId: branches[0]._id, passwordHash: staffPassword });

  if (withSampleOrders) await sampleOrders({ branches, items, rand, pick, between, days });

  return { ownerEmail, ownerPassword };
}

async function sampleOrders({ branches, items, rand, pick, between, days }) {
  const byCat = (cat) => items.filter((i) => i.categoryId === cat);
  const cats = await col('categories').find({}, { sort: { sort: 1 } });
  const [swallow, soups, mains, proteins] = cats.map((c) => byCat(c._id));
  const today = dayKey(new Date());
  const now = Date.now();
  const orders = [];
  let number = 1000;

  const basket = () => {
    const lines = new Map();
    const add = (it, q = 1) => lines.set(it._id, { it, qty: (lines.get(it._id)?.qty || 0) + q });
    if (rand() < 0.55) {
      add(pick(swallow), between(1, 2));
      add(pick(soups));
    } else {
      add(pick(mains), between(1, 2));
      if (rand() < 0.5) add(items.find((i) => i.name === 'Dodo (Plantain)'));
    }
    add(pick(proteins), between(1, 2));
    if (rand() < 0.3) add(pick(proteins));
    return [...lines.values()].map(({ it, qty }) => ({ itemId: it._id, name: it.name, price: it.price, qty, lineTotal: it.price * qty }));
  };

  for (let d = days; d >= 0; d--) {
    const key = addDays(today, -d);
    const dayStart = Date.parse(startOfLocalDay(key));
    const weekday = new Date(dayStart + 12 * 3600e3).getUTCDay();
    for (const b of branches) {
      const base = b.key === 'ogba' ? 22 : b.key === 'uniben' ? 14 : 9;
      const weekendBoost = weekday === 5 || weekday === 6 ? 1.3 : weekday === 0 ? 0.8 : 1;
      if (b.key === 'uniben' && (weekday === 0 || weekday === 6)) continue; // truck is off at weekends
      const count = Math.round(base * weekendBoost * (0.75 + rand() * 0.5) * (d === 0 ? 0.4 : 1));
      for (let n = 0; n < count; n++) {
        // Lunch and dinner peaks, 8am–9pm local.
        let at;
        if (d === 0) {
          // Today: spread over the last few hours so the live board has orders at every stage.
          at = now - between(2, 200) * 60e3;
          if (at < dayStart + 7 * 3600e3) at = dayStart + 7 * 3600e3 + between(0, 30) * 60e3;
        } else {
          const hour = rand() < 0.45 ? between(12, 14) : rand() < 0.6 ? between(18, 20) : between(8, 21);
          at = dayStart + hour * 3600e3 + between(0, 59) * 60e3;
        }
        if (at > now - 60e3) continue;
        const fulfilment = 'delivery'; // the app takes delivery orders only
        const lines = basket();
        const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
        const createdAt = new Date(at).toISOString();
        let status = rand() < 0.06 ? 'cancelled' : 'completed';
        // Today's most recent orders are still moving through the kitchen.
        const ageMin = (now - at) / 60e3;
        if (d === 0 && status !== 'cancelled' && ageMin < 120) {
          status = ageMin < 15 ? 'placed' : ageMin < 50 ? 'accepted' : fulfilment === 'delivery' && ageMin < 80 ? 'out_for_delivery' : 'completed';
        }
        const flow = ['placed', 'accepted', ...(fulfilment === 'delivery' ? ['out_for_delivery'] : []), 'completed'];
        const history = [];
        if (status === 'cancelled') {
          history.push({ status: 'placed', at: createdAt, by: 'customer' }, { status: 'cancelled', at: new Date(at + 6 * 60e3).toISOString(), by: `${b.name} Manager`, reason: pick(['Customer could not be reached', 'Customer cancelled on WhatsApp', 'Item ran out']) });
        } else {
          for (let i = 0; i <= flow.indexOf(status); i++) history.push({ status: flow[i], at: new Date(at + i * 20 * 60e3).toISOString(), by: i === 0 ? 'customer' : `${b.name} Manager` });
        }
        const first = pick(FIRST);
        orders.push({
          _id: crypto.randomUUID(),
          number: ++number,
          // New orders arrive without a branch; a branch takes them when it accepts.
          branchId: status === 'placed' ? null : b._id,
          branchName: status === 'placed' ? '' : b.name,
          channel: 'app',
          customer: {
            name: `${first} ${pick(LAST)}`,
            phone: `23480${between(10000000, 99999999)}`,
            address: fulfilment === 'delivery' ? `${between(1, 120)} ${pick(STREETS)}, Benin City` : '',
          },
          fulfilment,
          items: lines,
          subtotal,
          deliveryFee: 0,
          deliveryFeeExcluded: true,
          total: subtotal,
          note: rand() < 0.1 ? pick(['Extra pepper please', 'No pepper', 'Call when you get to the gate', 'Separate the soup']) : '',
          paymentMethod: 'pay_on_delivery',
          paymentStatus: status === 'completed' ? 'paid' : 'unpaid',
          paidWith: status === 'completed' ? pick(['cash', 'transfer', 'transfer', 'pos']) : null,
          status,
          statusHistory: history,
          cancelReason: status === 'cancelled' ? history[1].reason : undefined,
          completedAt: status === 'completed' ? history[history.length - 1].at : undefined,
          trackingToken: crypto.randomBytes(12).toString('hex'),
          createdAt,
          updatedAt: history[history.length - 1].at,
        });
      }
    }
  }
  orders.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  orders.forEach((o, i) => {
    o.number = 1001 + i;
    for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  });
  await col('orders').insertMany(orders);
  await col('counters').updateOne({ _id: 'order' }, { $set: { value: orders.length } }, { upsert: true });
}

// CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await connect();
  const reset = process.argv.includes('--reset');
  if (reset) await resetAll();
  if (!reset && (await col('branches').count({})) > 0) {
    console.log('The database already has data. Run `npm run seed -- --reset` to replace it with demo data.');
  } else {
    const { ownerEmail, ownerPassword } = await seed({ withSampleOrders: !process.argv.includes('--no-orders') });
    console.log(`Demo data loaded. Owner sign-in: ${ownerEmail} / ${ownerPassword}`);
  }
  await disconnect();
}
