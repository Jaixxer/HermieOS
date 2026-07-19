import { createDatabase, type Database } from '@hermieos/db';

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _db = createDatabase({ url });
  }
  return _db;
}

export function setDb(db: Database): void {
  _db = db;
}
