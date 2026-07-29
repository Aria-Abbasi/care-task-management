import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('Persian workspace audit', async ({ page }, testInfo) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await signIn(page)
  await page.goto('/app/settings')
  await page.getByRole('button', { name: /فارسی/ }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  for (const route of ['today', 'shift', 'schedule', 'timeline', 'medications', 'health', 'reports', 'messages', 'safety', 'settings']) {
    await page.goto(`/app/${route}`)
    await page.locator('.content').waitFor()
    if (route === 'schedule') {
      await expect(page.locator('.unified-calendar')).toBeVisible()
      await expect(page.locator('.agenda-event').first()).toBeVisible()
      await page.locator('.agenda-event').first().click()
      await expect(page.locator('.calendar-event-drawer')).toBeVisible()
      await page.locator('.calendar-event-drawer .modal-close').click()
      await page.getByRole('button', { name: 'هفته' }).click()
      await expect(page.locator('.compact-week-grid')).toBeVisible()
      await page.getByRole('button', { name: 'ماه' }).click()
      await expect(page.locator('.clean-month-grid section').first()).toBeVisible({ timeout: 15_000 })
    }
    if (route === 'shift') {
      await expect(page.locator('.mobile-shift-mode')).toBeVisible()
      await page.locator('.shift-action-card').first().click()
      await expect(page.locator('.modal[role="dialog"]')).toBeVisible()
      await expect(page.locator('.patient-safety-identity')).toBeVisible()
      await page.locator('.modal-close').first().click()
    }
    if (route === 'medications') {
      const firstDose = page.locator('.rtl-dose-row').first()
      if (await firstDose.count()) {
        await expect(firstDose.locator('.dose-medication')).toHaveAttribute('dir', 'ltr')
        await expect(firstDose.locator('.status-pill')).not.toHaveText(/Scheduled|Given|Missed|Refused|Held/)
      }
    }
    if (route === 'safety') {
      await expect(page.locator('.page-header')).toBeVisible()
      await expect(page.locator('.audit-export-button')).toBeVisible()
      await expect(page.locator('.audit-filters')).toBeVisible()
    }
    await page.screenshot({ path: testInfo.outputPath(`persian-${route}.png`), fullPage: true, animations: 'disabled' })
  }

  await page.goto('/app/today')
  await page.getByRole('button', { name: 'افزودن وظیفه' }).click()
  await expect(page.getByRole('heading', { name: 'ایجاد وظیفه' })).toBeVisible()
  await expect(page.getByText('جزئیات وظیفه')).toBeVisible()
  await expect(page.locator('.task-builder .modal-close')).toHaveCSS('left', '18px')

  expect(pageErrors).toEqual([])
})

test('safety-log header is usable in English', async ({ page }, testInfo) => {
  await signIn(page)
  await page.goto('/app/safety')
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
  await expect(page.getByRole('heading', { name: 'Safety & sync log' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export signed audit report' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Safety log filters' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('english-safety.png'), fullPage: true, animations: 'disabled' })
})
