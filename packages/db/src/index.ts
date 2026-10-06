import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };
export { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';

export const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/overpaid';

export function createDb(url = DATABASE_URL) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  return Object.assign(drizzle(client, { schema }), { $client: client });
}
export type Db = ReturnType<typeof createDb>;
