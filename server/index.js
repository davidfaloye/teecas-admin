import 'dotenv/config';
import { connect, col } from './db.js';
import { createApp } from './app.js';
import { seed } from './seed.js';

const PORT = Number(process.env.PORT) || 4000;

const mode = await connect();

// First run: load the three demo branches, the menu and sample data so the dashboard and the
// app have something to show. Set SEED_DEMO=false to start empty in production.
if ((await col('branches').count({})) === 0 && process.env.SEED_DEMO !== 'false') {
  const { ownerEmail, ownerPassword } = await seed({ withSampleOrders: true });
  console.log(`[seed] Demo data loaded. Owner sign-in: ${ownerEmail} / ${ownerPassword}`);
}

createApp().listen(PORT, () => {
  console.log(`Teecas admin running on http://localhost:${PORT} (database: ${mode === 'mongo' ? 'MongoDB' : 'local file'})`);
});
