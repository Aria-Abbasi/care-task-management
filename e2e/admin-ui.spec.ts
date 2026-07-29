import { expect, test } from '@playwright/test'

async function signInAsAdmin(page: import('@playwright/test').Page) {
  await page.goto('/app/today')
  await page.getByLabel('Phone number or email').fill('admin@havencare.com')
  await page.getByLabel('Password', { exact: true }).fill('admin-demo')
  await page.getByRole('button', { name: /sign in securely/i }).click()
  await page.getByRole('heading', { name: /Good (morning|afternoon|evening)/i }).waitFor()
}

test('administrator can review operations and open the patient editor', async ({ page }, testInfo) => {
  await signInAsAdmin(page)
  await page.goto('/app/admin')

  await expect(page.getByRole('heading', { name: 'Administration' })).toBeVisible()
  await expect(page.locator('.admin-hero')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Administration overview' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add team member' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add patient' })).toBeVisible()
  await expect(page.locator('.admin-section')).toHaveCount(9)
  await expect(page.getByRole('button', { name: /Show all \d+ deliveries/ })).toBeVisible()

  await page.getByRole('button', { name: 'Add patient' }).click()
  await expect(page.getByRole('dialog', { name: 'Add patient' })).toBeVisible()
  await expect(page.getByLabel('First name')).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog', { name: 'Add patient' })).toBeHidden()

  await page.screenshot({ path: testInfo.outputPath('admin-dashboard.png'), fullPage: true, animations: 'disabled' })
})

test('administrator workspace is fully usable in Persian RTL', async ({ page }, testInfo) => {
  await signInAsAdmin(page)
  await page.goto('/app/settings')
  await page.getByRole('button', { name: /فارسی/ }).click()
  await page.goto('/app/admin')

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { name: 'مدیریت' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'افزودن عضو تیم' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'افزودن بیمار' })).toBeVisible()
  await expect(page.getByText('تحویل اعلان‌ها و پیام‌های متوقف‌شده')).toBeVisible()

  await page.getByRole('button', { name: 'افزودن بیمار' }).click()
  await expect(page.getByRole('dialog', { name: 'افزودن بیمار' })).toBeVisible()
  await expect(page.getByLabel('نام', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'انصراف' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('admin-dashboard-fa.png'), fullPage: true, animations: 'disabled' })
})
