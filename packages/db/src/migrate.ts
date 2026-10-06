import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './index.js';

const db = createDb();
await migrate(db, { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
await db.$client.end();
console.log('migrations applied');
