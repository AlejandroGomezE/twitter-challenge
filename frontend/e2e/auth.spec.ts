import { expect, test, type Page } from '@playwright/test'
import { signUp, uniqueUser, type TestUser } from './helpers'

// Auth flow through the real UI and API. Each test signs up its own user, so they don't depend on
// each other or on run order (the rate-limit budget is in helpers.ts).

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function expectSignedInHome(page: Page, user: TestUser) {
  await expect(page).toHaveURL('/')
  // The left rail's Profile link points at the signed-in user's handle.
  await expect(
    page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Profile' }),
  ).toHaveAttribute('href', `/u/${user.username}`)
  await expect(page.getByText(`@${user.username}`).first()).toBeVisible()
}

test('sign up, sign out, get bounced from a gated page, then sign back in', async ({ page }) => {
  const user = uniqueUser('flow')

  await signUp(page, user)
  await expectSignedInHome(page, user)

  await page.getByRole('link', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/sign-in')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  // A gated URL sends a signed-out visitor back to sign-in.
  await page.goto('/')
  await expect(page).toHaveURL('/sign-in')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()

  await signIn(page, user.email, user.password)
  await expectSignedInHome(page, user)
})

test('a wrong password shows an error and stays on sign-in', async ({ page }) => {
  const user = uniqueUser('badpw')

  await signUp(page, user)
  await expectSignedInHome(page, user)
  await page.getByRole('link', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/sign-in')

  await signIn(page, user.email, 'not-the-right-password')
  await expect(page.getByText('Invalid email or password')).toBeVisible()
  await expect(page).toHaveURL('/sign-in')
})
