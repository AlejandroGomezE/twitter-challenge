import { Logger } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import 'dotenv/config';
import { PrismaClient } from '../../generated/prisma/client.js';
import { resolveDatabaseUrl } from '../prisma.service.js';
import { runSeed } from './run-seed.js';

// CLI entry for `npm run db:seed` / `npx prisma db seed`, run compiled from
// dist/database/seed/seed.js. Resets the database to the seed data set;
// with --if-empty, leaves a database that already has users untouched.
// DATABASE_URL comes from the environment (backend/.env is loaded when
// present, as main.ts does) and resolves exactly like PrismaService.

const USAGE = 'Usage: node dist/database/seed/seed.js [--if-empty]';

const logger = new Logger('Seed');

// Returns null on an unknown argument.
function parseArgs(argv: string[]): { ifEmpty: boolean } | null {
  let ifEmpty = false;
  for (const arg of argv) {
    if (arg !== '--if-empty') {
      logger.error(`Unknown argument: ${arg}. ${USAGE}`);
      return null;
    }
    ifEmpty = true;
  }
  return { ifEmpty };
}

async function main(ifEmpty: boolean): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: resolveDatabaseUrl(process.env.DATABASE_URL),
    }),
  });

  try {
    const summary = await runSeed(prisma, { ifEmpty });
    if (summary.skipped) {
      logger.log('Skipped: database already has users');
      return;
    }
    logger.log(
      `Seeded ${summary.users} users, ${summary.posts} posts, ` +
        `${summary.follows} follows, ${summary.likes} likes, ` +
        `${summary.comments} comments, ${summary.notifications} notifications`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args) {
  process.exitCode = 1;
} else {
  try {
    await main(args.ifEmpty);
  } catch (error) {
    logger.error(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    process.exitCode = 1;
  }
}
