import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Browser E2E against the real stack. Playwright boots its OWN backend and frontend on ports that
// don't clash with the dev servers (3000/5173), and the backend uses a dedicated SQLite file
// (backend/prisma/playwright.db — relative `file:` URLs resolve against backend/prisma/), so a run
// never touches dev.db or e2e.db.
const BACKEND_PORT = 3100
const FRONTEND_PORT = 5174
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`
const DATABASE_URL = 'file:./playwright.db'

const backendDir = path.resolve(import.meta.dirname, '../backend')

// Start from an empty database every run: delete the dedicated SQLite file (and its -journal/-wal
// siblings), then `prisma db push` creates it with the current schema. Deleting the throwaway file
// is equivalent to `db push --force-reset` and needs no interactive confirmation.
const resetDatabase = `node -e "const fs=require('node:fs');for(const f of fs.readdirSync('prisma'))if(/^playwright\\.db/.test(f))fs.rmSync('prisma/'+f)"`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // The auth endpoints are rate limited (5 requests/min per IP per route); one worker keeps the
  // request count predictable.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: FRONTEND_URL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // No watch mode: build once, then run the compiled app.
      command: `${resetDatabase} && npx prisma db push && npm run build && node dist/main.js`,
      cwd: backendDir,
      // GET /auth/me answers 401 without a session, which Playwright counts as "ready".
      url: `${BACKEND_URL}/auth/me`,
      // Explicit env wins over backend/.env: dotenv never overrides variables that are already set.
      env: {
        DATABASE_URL,
        PORT: String(BACKEND_PORT),
        FRONTEND_ORIGIN: FRONTEND_URL,
        // Not production, so the session cookie isn't `Secure` and works over plain http.
        NODE_ENV: 'development',
      },
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: `npx vite --port ${FRONTEND_PORT} --strictPort`,
      url: FRONTEND_URL,
      // Variables already in the environment take precedence over frontend/.env in Vite.
      env: { VITE_API_URL: BACKEND_URL },
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})
