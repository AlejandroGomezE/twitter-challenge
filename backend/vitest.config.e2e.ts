import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { E2E_DATABASE_URL } from './test/e2e-database.js';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Fresh, dedicated SQLite DB per run (backend/prisma/e2e.db) — never the dev DB. Set here so it
    // wins over backend/.env (dotenv and @nestjs/config don't override an already-set variable).
    globalSetup: ['./test/global-setup.ts'],
    env: { DATABASE_URL: E2E_DATABASE_URL },
  },
});
