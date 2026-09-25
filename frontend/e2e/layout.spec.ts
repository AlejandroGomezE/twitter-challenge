import { expect, test, type Page } from '@playwright/test'
import { signUp, uniqueUser } from './helpers'

// The app shell at the spec's three breakpoints: mobile (< 640px), tablet (640–1024px) and desktop.
// jsdom can't evaluate Tailwind breakpoints, so this is where the responsive layout is tested.

function shell(page: Page) {
  const rail = page.getByRole('banner')
  return {
    rail,
    railNav: rail.getByRole('navigation', { name: 'Primary', exact: true }),
    railNewPost: rail.getByRole('button', { name: 'New post' }),
    bottomNav: page.getByRole('navigation', { name: 'Primary (mobile)' }),
    // Hidden elements drop out of role queries, so this matches only the visible "New post" buttons.
    newPostButtons: page.getByRole('button', { name: 'New post' }),
    main: page.getByRole('main'),
    rightRail: page.getByRole('complementary', { name: 'Sidebar' }),
  }
}

async function expectNoHorizontalScroll(page: Page) {
  const overflows = await page
    .locator('html')
    .evaluate((html) => html.scrollWidth > html.clientWidth)
  expect(overflows).toBe(false)
}

test('the app shell adapts to mobile, tablet and desktop widths', async ({ page }) => {
  await signUp(page, uniqueUser('layout'))
  await expect(page).toHaveURL('/')
  const s = shell(page)

  await test.step('mobile, 375px: bottom nav and floating compose button, no rails', async () => {
    await page.setViewportSize({ width: 375, height: 800 })
    await expect(s.bottomNav).toBeVisible()
    await expect(s.rail).toBeHidden()
    await expect(s.rightRail).toBeHidden()
    // The only visible "New post" is the floating button outside the rail.
    await expect(s.newPostButtons).toHaveCount(1)
    await expect(s.railNewPost).toBeHidden()
    const main = await s.main.boundingBox()
    expect(main?.width).toBe(375)
    await expectNoHorizontalScroll(page)
  })

  await test.step('tablet, 768px: icon-only rail and a centred 620px column', async () => {
    await page.setViewportSize({ width: 768, height: 800 })
    await expect(s.railNav).toBeVisible()
    await expect(s.railNav.getByText('Home', { exact: true })).toBeHidden()
    await expect(s.bottomNav).toBeHidden()
    await expect(s.rightRail).toBeHidden()
    await expect(s.newPostButtons).toHaveCount(1)
    await expect(s.railNewPost).toBeVisible()

    const rail = await s.rail.boundingBox()
    const main = await s.main.boundingBox()
    expect(main?.width).toBe(620)
    // Rail and column are centred as a group: equal space on both sides.
    const leftGap = rail!.x
    const rightGap = 768 - (main!.x + main!.width)
    expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(1)
    await expectNoHorizontalScroll(page)

    await s.railNav.getByRole('link', { name: 'Explore' }).click()
    await expect(page).toHaveURL('/explore')
  })

  await test.step('desktop, 1280px: labelled rail and the right rail', async () => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(s.railNav.getByText('Home', { exact: true })).toBeVisible()
    await expect(s.rightRail).toBeVisible()
    await expect(s.bottomNav).toBeHidden()
    await expect(s.newPostButtons).toHaveCount(1)
    await expect(s.railNewPost).toBeVisible()
    await expectNoHorizontalScroll(page)
  })
})
