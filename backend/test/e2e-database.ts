// Relative `file:` URLs resolve against backend/prisma/ (see prisma7.config.ts and
// src/database/prisma.service.ts), so this is backend/prisma/e2e.db — git-ignored by `/prisma/*.db*`.
export const E2E_DATABASE_URL = 'file:./e2e.db';
