import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('caregiver dashboard matches the approved visual baseline', async ({ page }) => {
  await signIn(page)
  await page.locator('.content').evaluate((node) => node.classList.add('visual-test'))
  await expect(page).toHaveScreenshot('caregiver-dashboard.png', { fullPage: true, animations: 'disabled', maxDiffPixelRatio: 0.01 })
})
