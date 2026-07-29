import type { Page } from '@playwright/test'

export async function signIn(page: Page) {
  await page.goto('/app/today')
  await page.getByLabel('Phone number or email').fill('sarah@havencare.com')
  await page.getByLabel('Password', { exact: true }).fill('caregiver')
  await page.getByRole('button', { name: /sign in securely/i }).click()
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i }).waitFor()
}

export async function openNavigation(page: Page) {
  const menuButton = page.getByRole('button', { name: 'Open menu' })
  if (await menuButton.isVisible()) await menuButton.click()
}
