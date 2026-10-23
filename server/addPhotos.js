// One-off: give menu items that have no photo yet the stand-in photo from menuPhotos.js.
// Items that already have a photo (for example the restaurant's own) are left alone.
//
//   npm run photos            uses MONGODB_URI from the environment or .env
//   npm run photos -- --dry   only lists what would change

import 'dotenv/config';
import { col, connect, dbMode, disconnect } from './db.js';
import { MENU_PHOTOS } from './menuPhotos.js';

const dry = process.argv.includes('--dry');
await connect();
console.log(`Database: ${dbMode() === 'mongo' ? 'MongoDB' : 'local file (MONGODB_URI not set)'}${dry ? ' (dry run)' : ''}`);

let added = 0;
for (const item of await col('menuItems').find({})) {
  const url = MENU_PHOTOS[item.name];
  if (!url || item.imageUrl) continue;
  if (!dry) await col('menuItems').updateOne({ _id: item._id }, { $set: { imageUrl: url } });
  console.log(`  ${dry ? 'would add' : 'added'}: ${item.name}`);
  added++;
}
console.log(`${added} item(s) ${dry ? 'would get' : 'got'} a photo.`);
await disconnect();
