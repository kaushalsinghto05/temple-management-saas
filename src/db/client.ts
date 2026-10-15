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

let globalClient: PGlite | pg.Pool | null = null;
let globalDb: any = null;

export function getRawClient(): PGlite | pg.Pool {
  if (!globalClient) {
    if (process.env.DATABASE_URL) {
      const isLocalhost = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
      const disableSsl = process.env.DATABASE_SSL === 'false' || isLocalhost;
      const ssl = disableSsl ? undefined : { rejectUnauthorized: false };

      globalClient = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        ssl,
      });
      globalDb = drizzlePg(globalClient as pg.Pool, { schema });
    } else {
      globalClient = new PGlite();
      globalDb = drizzlePgLite(globalClient as PGlite, { schema });
    }
  }
  return globalClient;
}

export function getDb(): any {
  const store = txStorage.getStore();
  if (store && store.db) {
    return store.db;
  }
  if (!globalDb) {
    getRawClient();
  }
  return globalDb;
}

export async function resetClient(): Promise<void> {
  if (globalClient) {
    if ('end' in globalClient) {
      await (globalClient as pg.Pool).end();
    } else if ('close' in globalClient) {
      await (globalClient as PGlite).close();
    }
  }
  globalClient = null;
  globalDb = null;
}
