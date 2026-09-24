import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

// No domain module queries the database yet, so this intentionally doesn't
// $connect() eagerly in onModuleInit — the underlying pg.Pool the adapter
// wraps connects lazily on first query, letting the app boot without a
// reachable Postgres instance.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
