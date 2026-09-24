import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_DATABASE_URL } from './e2e-database.js';

// The e2e suite runs against its own SQLite file (backend/prisma/e2e.db, git-ignored), never the
// dev DB. Each run starts from an empty file built from the current schema: delete it, then a
// plain `prisma db push` creates it fresh (no destructive reset of any existing database).
const BACKEND_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E2E_DB_FILE = path.join(BACKEND_DIR, 'prisma', E2E_DATABASE_URL.replace(/^file:/, ''));

function removeDatabaseFiles(): void {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${E2E_DB_FILE}${suffix}`, { force: true });
  }
}

export default function setup(): () => void {
  removeDatabaseFiles();
  execFileSync(process.execPath, [path.join(BACKEND_DIR, 'node_modules', 'prisma', 'build', 'index.js'), 'db', 'push'], {
    cwd: BACKEND_DIR,
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
    stdio: 'pipe',
  });
  return removeDatabaseFiles;
}
