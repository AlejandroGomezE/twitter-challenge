import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';

// A relative `file:` DATABASE_URL has no inherent anchor: left alone, the
// better-sqlite3 driver adapter used below resolves it against
// process.cwd(), which silently diverges from wherever the CLI
// (`prisma generate`/`db push`/etc., configured in prisma7.config.ts) puts
// it, depending on the invocation directory. To guarantee the CLI and the
// running app always agree on the exact same physical database file, both
// resolve relative paths the same way: anchored to backend/prisma/, derived
// from their own module's location rather than process.cwd(). This file
// sits directly under backend/ both in src/database during development and
// dist/database after a build, so `../../prisma` lands on backend/prisma/
// either way. See prisma7.config.ts for the matching CLI-side resolution.
const PRISMA_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'prisma',
);

// Also used by the seed CLI (src/database/seed/seed.ts), which runs outside
// Nest, so it stays in this module: PRISMA_DIR is derived from this file's
// location, whoever the caller is.
export function resolveDatabaseUrl(databaseUrl?: string): string {
  // DATABASE_URL is validated as a required, non-empty string at boot by
  // src/config/environment.validation.ts before this service is
  // constructed, so for the app the fallback below is unreachable in
  // practice; the seed CLI has no such validation and relies on it.
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const rawPath = databaseUrl.replace(/^file:/, '');
  if (rawPath === ':memory:' || path.isAbsolute(rawPath)) {
    return databaseUrl;
  }
  return `file:${path.resolve(PRISMA_DIR, rawPath)}`;
}

// No domain module queries the database yet, so this intentionally doesn't
// $connect() eagerly in onModuleInit — the underlying better-sqlite3 handle
// the adapter wraps opens the database file lazily on first query, letting
// the app boot even before the SQLite file exists on disk.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      adapter: new PrismaBetterSqlite3({
        url: resolveDatabaseUrl(process.env.DATABASE_URL),
      }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
