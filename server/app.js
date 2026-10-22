import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { requireAuth } from './auth.js';
import { subscribe } from './events.js';
import { HttpError } from './lib.js';
import { dbMode } from './db.js';
import { cloudApiEnabled } from './whatsapp.js';
import publicRoutes from './routes/public.js';
import accountRoutes from './routes/account.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import menuRoutes from './routes/menu.js';
import inventoryRoutes from './routes/inventory.js';
import branchRoutes from './routes/branches.js';
import userRoutes from './routes/users.js';
import analyticsRoutes from './routes/analytics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (req, res) =>
    res.json({
      ok: true,
      db: dbMode(),
      whatsappCloudApi: cloudApiEnabled(),
      // Show the demo sign-ins on the login page only for demo deployments.
      demoLogins: process.env.SHOW_DEMO_LOGINS ? process.env.SHOW_DEMO_LOGINS === 'true' : dbMode() === 'file',
    }),
  );

  app.use('/api/public/account', accountRoutes); // app customers' accounts
  app.use('/api/public', publicRoutes);
  app.use('/api/auth', authRoutes);

  // Everything below needs a signed-in staff member.
  app.get('/api/events', requireAuth, subscribe);
  app.use('/api/orders', requireAuth, orderRoutes);
  app.use('/api/menu', requireAuth, menuRoutes);
  app.use('/api/inventory', requireAuth, inventoryRoutes);
  app.use('/api/branches', requireAuth, branchRoutes);
  app.use('/api/users', requireAuth, userRoutes);
  app.use('/api/analytics', requireAuth, analyticsRoutes);

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));

  // The admin web app (built into web/dist by `npm run build`).
  const dist = path.join(__dirname, '..', 'web', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (req, res) =>
      res.type('text').send('Teecas admin API is running. Build the dashboard with `npm run build`.'),
    );
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'The request body is not valid JSON.', code: 'BAD_JSON' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side. Try again.', code: 'SERVER_ERROR' });
  });

  return app;
}
