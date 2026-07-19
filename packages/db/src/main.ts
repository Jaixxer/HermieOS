import 'dotenv/config';
import { closeDatabase, createDatabase } from './index.js';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. See .env.example.');
    process.exit(1);
  }
  const db = createDatabase({ url });
  // smoke check
  const rows = await db.$client`select 1 as ok`;
  // eslint-disable-next-line no-console
  console.log('db ping:', rows);
  await closeDatabase(db);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
