# Teecas Admin

The back office for Teecas Amala Express Bukka's three branches, and the API the Teecas ordering app talks to.

- **Today**: sales, orders in progress, each branch at a glance, low stock.
- **Orders**: a live board (new → accepted → preparing → ready → out for delivery → completed) with a sound and pop-up when an app order arrives, a large-type kitchen view, history and search. Every order is pay on delivery; staff record cash, transfer or POS when it's collected.
- **Menu**: dishes, prices, categories, and a per-branch "sold out" switch that the app picks up straight away.
- **Inventory**: stock per branch, reorder levels, stock in, usage, waste, counts, and a log of every change.
- **Sales analytics**: sales by day, branch, dish and hour, compared with the period before, with CSV export.
- **Branches**: address, hours, WhatsApp number and delivery fee for each, plus a switch to pause app orders.
- **Team**: sign-ins for owners, branch managers, cashiers and kitchen staff.

| Role | Sees |
| --- | --- |
| Owner | Everything, every branch |
| Branch manager | Orders, menu availability, stock and sales for their branch; can pause app orders there |
| Cashier | Orders, payments and stock for their branch |
| Kitchen | The order board only; moves orders to preparing and ready |

## Run it locally

```bash
cd admin
npm install
npm run build      # builds the dashboard into web/dist
npm start          # http://localhost:4000
```

With no `MONGODB_URI`, data is kept in `admin/data/dev-db.json`. The first start loads demo data: three branches (Ogba Road, Uniben, Ring Road), the menu from teecas.online, dummy stock for each branch, and five weeks of sample orders.

Demo sign-ins (password `teecas-demo`):

- `owner@teecas.online`: owner, all branches
- `ogba@teecas.online`, `uniben@teecas.online`, `ringroad@teecas.online`: branch managers
- `kitchen.ogba@teecas.online`, `cashier.ogba@teecas.online`: Ogba Road kitchen and cashier

`npm run seed -- --reset` wipes the data and reloads the demo. `npm run dev` runs the API and a hot-reloading dashboard on http://localhost:5173. `npm test` runs the API checks.

## Deploy on Render

1. Create a free MongoDB Atlas cluster and copy its connection string.
2. In Render, create a **Web Service** from this repo with:
   - Root directory: `admin`
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
3. Set environment variables: `MONGODB_URI`, a long random `JWT_SECRET`, and `SEED_OWNER_PASSWORD` (the owner's first password). See `.env.example` for the rest.
4. After the first deploy, sign in as the owner, change the password (My account), then edit the branches: real names, addresses and each branch's WhatsApp number. Replace the dummy stock with real counts.

For the client showcase, leave `SEED_DEMO` on so the dashboard opens with sample data. Before going live, run `npm run seed -- --reset --no-orders` against the production database (or set `SEED_DEMO=false` on a fresh one) so the sample orders don't mix with real ones.

The free Render plan sleeps after inactivity, so the first request after a quiet spell takes a few seconds. A paid instance stays awake, which matters for a live order board.

## How orders reach the restaurant

1. The customer places an order in the app. The API checks each dish is available at that branch, prices it from the menu (never from the phone), and saves it as pay on delivery.
2. The order appears on the admin board instantly, with a sound.
3. The app opens WhatsApp with the order pre-written to that branch's WhatsApp number, the same way teecas.online does today, so the branch gets it on WhatsApp too.
4. As staff move the order along, the customer's app updates.

To have the server message the branch directly as well (without relying on the customer tapping Send), set the WhatsApp Cloud API variables in `.env.example`.

## API used by the app

No sign-in needed; all under `/api/public`.

| Endpoint | Purpose |
| --- | --- |
| `GET /branches` | Branches with address, hours, WhatsApp, delivery fee, open/paused |
| `GET /menu?branchId=` | Categories and dishes, with availability at that branch |
| `POST /orders` | Place an order: `{ branchId, fulfilment, customer: { name, phone, address }, items: [{ id, qty }], note }` |
| `GET /orders/:id?token=` | Order status for tracking (token is returned when the order is placed) |

## Code layout

- `server/`: Express API. `db.js` (MongoDB or local file store), `orders.js` (pricing and status rules), `routes/`, `seed.js` (demo data).
- `web/`: React dashboard built with Vite.
