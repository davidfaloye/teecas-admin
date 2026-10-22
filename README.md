# Teecas Admin

The back office for Teecas Amala Express Bukka's three branches, and the API the Teecas ordering app talks to.

- **Today**: sales, orders in progress, each branch at a glance, low stock.
- **Orders**: a live board in four columns: Incoming order → Accepted order → Out for delivery → Order delivered & paid. Each column has a `?` that explains it. A sound and pop-up announce new app orders. Every order is pay on delivery: marking an order delivered & paid asks how the customer paid (cash, transfer or POS). App orders arrive with no branch: every branch sees them in Incoming, and whoever accepts one assigns it (branch staff take it for their own branch, the owner picks a branch). Delivery fees aren't added to order totals; the rider settles delivery with the customer. Pickup orders (only possible when a branch is given) skip Out for delivery. History and search are on the second tab. (A large-type kitchen view is built but switched off; see the comment at the top of `web/src/pages/Orders.jsx`.)
- **Menu**: dishes, prices, categories, and a per-branch "sold out" switch that the app picks up straight away.
- **Inventory**: stock per branch, reorder levels, stock in, usage, waste, counts, and a log of every change.
- **Sales analytics**: sales by day, branch, dish and hour, compared with the period before, with CSV export.
- **Branches**: address, hours, WhatsApp number and usual delivery fee (for reference) for each, plus a switch to pause app orders.
- **Team**: sign-ins for owners, branch managers, cashiers and kitchen staff.

| Role | Sees |
| --- | --- |
| Owner | Everything, every branch |
| Branch manager | Orders, menu availability, stock and sales for their branch; can pause app orders there |
| Cashier | Orders, payments and stock for their branch |
| Kitchen | The order board, read-only (for the kitchen view when it's switched back on) |

## Run it locally

```bash
npm install
npm run build      # builds the dashboard into web/dist
npm start          # http://localhost:4000
```

With no `MONGODB_URI`, data is kept in `data/dev-db.json`. The first start loads demo data: three branches (Ogba Road, Uniben, Ring Road), the menu from teecas.online, dummy stock for each branch, and five weeks of sample orders.

Demo sign-ins (password `teecas-demo`):

- `owner@teecas.online`: owner, all branches
- `ogba@teecas.online`, `uniben@teecas.online`, `ringroad@teecas.online`: branch managers
- `kitchen.ogba@teecas.online`, `cashier.ogba@teecas.online`: Ogba Road kitchen and cashier

`npm run seed -- --reset` wipes the data and reloads the demo. `npm run dev` runs the API and a hot-reloading dashboard on http://localhost:5173. `npm test` runs the API checks.

## Deploy on Render

1. Create a free MongoDB Atlas cluster. Under Network Access, allow `0.0.0.0/0` (Render's addresses change), and copy the connection string.
2. In Render, choose **New → Blueprint** and pick this repo. `render.yaml` sets up the web service; Render asks for `MONGODB_URI` and `SEED_OWNER_PASSWORD` and generates `JWT_SECRET`.
   (Or **New → Web Service** by hand: build `npm install && npm run build`, start `npm start`, and the same environment variables.)
3. Add the custom domain `admin.teecas.online` (in the Blueprint already). In Namecheap, add a CNAME record: host `admin`, value the service's `….onrender.com` address. Render issues the HTTPS certificate.
4. After the first deploy, sign in as the owner (`owner@teecas.online` and the `SEED_OWNER_PASSWORD` you set), change the password (My account), then edit the branches: real names, addresses and each branch's WhatsApp number. Replace the dummy stock with real counts.
5. Point the ordering app at it: `EXPO_PUBLIC_API_URL=https://admin.teecas.online`.

For the client showcase, leave `SEED_DEMO` on so the dashboard opens with sample data. Before going live, run `npm run seed -- --reset --no-orders` against the production database (or set `SEED_DEMO=false` on a fresh one) so the sample orders don't mix with real ones.

`render.yaml` uses the Starter plan. The free plan sleeps after inactivity, so the first request after a quiet spell takes a while and the live board can miss new orders.

## How orders reach the restaurant

1. The customer places a delivery order in the app. They don't choose a branch. The API checks each dish is on the menu, prices it from the menu (never from the phone), and saves it as pay on delivery with no branch. The total is food only; the delivery fee is settled with the rider.
2. The order appears in Incoming on every branch's board instantly, with a sound, marked "No branch yet".
3. The app opens WhatsApp with the order pre-written to `ORDERS_WHATSAPP` (or the first open branch's number), the same way teecas.online does today.
4. The branch closest to the customer that has the food accepts it. Branch staff see "Accept for <their branch>"; the owner chooses a branch. The order then leaves the other branches' boards, and the customer's app shows which branch is preparing it.
5. That branch sends it out for delivery, then marks it delivered & paid with the payment method. The customer's app updates at each step.

To have the server message the branch directly as well (without relying on the customer tapping Send), set the WhatsApp Cloud API variables in `.env.example`.

## API used by the app

No sign-in needed; all under `/api/public`.

| Endpoint | Purpose |
| --- | --- |
| `GET /branches` | Branches with address, hours, WhatsApp, delivery fee, open/paused |
| `GET /menu` | Categories and dishes; `?branchId=` gives availability at one branch |
| `POST /orders` | Place an order: `{ customer: { name, phone, address }, items: [{ id, qty }], note }`. Optional `branchId` (and then `fulfilment: 'pickup'`) to send it straight to one branch |
| `GET /orders/:id?token=` | Order status for tracking (token is returned when the order is placed) |

## Code layout

- `server/`: Express API. `db.js` (MongoDB or local file store), `orders.js` (pricing and status rules), `routes/`, `seed.js` (demo data).
- `web/`: React dashboard built with Vite.
