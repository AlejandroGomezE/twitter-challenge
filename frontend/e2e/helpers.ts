import type { Page } from '@playwright/test'

// Shared by the browser E2E specs. The backend rate limits sign-up and sign-in to 5 requests per
// minute per IP (per route), and the whole suite shares that budget: it sends 3 sign-ups and
// 2 sign-ins per run.

const PASSWORD = 'correct-horse-battery'

export interface TestUser {
  email: string
  username: string
  displayName: string
  password: string
}

export function uniqueUser(prefix: string): TestUser {
  // Usernames are 3–20 chars of letters, numbers and underscores.
  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
  const username = `${prefix}_${suffix}`.slice(0, 20)
  return {
    email: `${username}@example.com`,
    username,
    displayName: `E2E ${prefix}`,
    password: PASSWORD,
  }
}

export async function signUp(page: Page, user: TestUser) {
  await page.goto('/sign-up')
  await page.getByLabel('Name', { exact: true }).fill(user.displayName)
  await page.getByLabel('Username', { exact: true }).fill(user.username)
  await page.getByLabel('Email', { exact: true }).fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByLabel('Confirm password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Create account' }).click()
}
