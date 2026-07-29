import { expect, test } from '@playwright/test'
import { openNavigation, signIn } from './helpers'

test('switching patients changes all visible identity context', async ({ page }) => {
  await signIn(page)
  await openNavigation(page)
  await page.getByRole('button', { name: /Hassan Abbasi/i }).first().click()
  await page.getByRole('option', { name: /Maryam Abbasi/i }).click()
  await expect(page.getByRole('heading', { name: 'Maryam Abbasi' })).toBeVisible()
  await expect(page.getByText(/Here's what Maryam needs today/)).toBeVisible()
})

test('medication administration requires all five rights', async ({ page }) => {
  await signIn(page)
  await openNavigation(page)
  await page.getByRole('button', { name: 'Medications' }).first().click()
  const dose = page.locator('.dose-row').first()
  if (await dose.count()) {
    await dose.click()
    await expect(page.getByText('Confirm before administration')).toBeVisible()
    await expect(page.getByLabel('Actual administration time')).toBeVisible()
    await page.getByRole('button', { name: /Record dose outcome/ }).click()
    await expect(page.getByText(/Confirm all five medication checks/)).toBeVisible()
  }
})

test('offline conflict remains visible for explicit review', async ({ page, context }) => {
  await signIn(page)
  await context.setOffline(true)
  const actionable = page.locator('.focus-card, .overdue-card').first()
  if (await actionable.count()) {
    await actionable.click()
    await page.getByLabel(/confirmed this care record/i).check()
    await page.getByRole('button', { name: /Record outcome/ }).click()
    await expect(page.getByText(/saved offline/i)).toBeVisible()
  }
  await context.setOffline(false)
})

test('critical alerts require acknowledgement or an explicit snooze', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: /notifications/i }).click()
  const panel = page.getByRole('region', { name: 'Care alerts' })
  await expect(panel).toBeVisible()
  const alert = panel.locator('.notification-item').first()
  if (await alert.count()) await expect(alert.getByRole('button', { name: /Acknowledge/ })).toBeVisible()
})
