import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePgLite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import { AsyncLocalStorage } from 'node:async_hooks';

export type DbType = ReturnType<typeof drizzlePgLite<typeof schema>> | ReturnType<typeof drizzlePg<typeof schema>>;

export interface TxContext {
  tx: any;
  db: any;
  tenantId?: string;
}

export const txStorage = new AsyncLocalStorage<TxContext>();

const globalForDb = globalThis as unknown as {
  globalClient: PGlite | pg.Pool | null;
  globalDb: any;
};

if (!globalForDb.globalClient) {
  globalForDb.globalClient = null;
  globalForDb.globalDb = null;
}

export function getRawClient(): PGlite | pg.Pool {
  if (!globalForDb.globalClient) {
    if (process.env.DATABASE_URL) {
      const isLocalhost = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
      const disableSsl = process.env.DATABASE_SSL === 'false' || isLocalhost;
      const ssl = disableSsl ? undefined : { rejectUnauthorized: false };

      globalForDb.globalClient = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        ssl,
      });
      globalForDb.globalDb = drizzlePg(globalForDb.globalClient as pg.Pool, { schema });
    } else {
      const dataDir = process.env.VITEST ? undefined : './.pgdata';
      globalForDb.globalClient = new PGlite(dataDir);
      globalForDb.globalDb = drizzlePgLite(globalForDb.globalClient as PGlite, { schema });
    }
  }
  return globalForDb.globalClient;
}

export function getDb(): any {
  const store = txStorage.getStore();
  if (store && store.db) {
    return store.db;
  }
  if (!globalForDb.globalDb) {
    getRawClient();
  }
  return globalForDb.globalDb;
}

export async function resetClient(): Promise<void> {
  if (globalForDb.globalClient) {
    if ('end' in globalForDb.globalClient) {
      await (globalForDb.globalClient as pg.Pool).end();
    } else if ('close' in globalForDb.globalClient) {
      await (globalForDb.globalClient as PGlite).close();
    }
  }
  globalForDb.globalClient = null;
  globalForDb.globalDb = null;
}
