/**
 * DB singleton. The actual client is injected by the entry point:
 *   - src/index.ts  (RPI) uses @libsql/client (native SQLite + remote)
 *   - api/index.ts  (Vercel) uses @libsql/client/http (no native deps)
 *
 * This module never imports a libsql client itself, so Vercel's bundler
 * never tries to include the native libsql binary.
 */
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

let _db: LibSQLDatabase<typeof schema> | undefined;

export function setDb(db: LibSQLDatabase<typeof schema>): void {
  _db = db;
}

// Proxy forwards all property access to the real db instance.
// setDb() must be called by the entry point before any requests are handled.
export const db: LibSQLDatabase<typeof schema> = new Proxy(
  {} as LibSQLDatabase<typeof schema>,
  {
    get(_target, prop) {
      if (!_db) throw new Error("Database not initialized — call setDb() before handling requests");
      return (_db as any)[prop];
    },
  }
);

export { schema };
