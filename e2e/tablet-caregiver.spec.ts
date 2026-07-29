import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== 'caregiver-tablet', 'This suite covers the caregiver touch layout.')
})

test('Persian caregiver tablet flow keeps identity and safety actions touch-ready', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/settings')
  await page.getByRole('button', { name: /فارسی/ }).tap()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')

  await page.goto('/app/shift')
  await expect(page.locator('.mobile-shift-mode')).toBeVisible()
  await expect(page.locator('.shift-patient-lockup')).toContainText('Hassan Abbasi')
  const careAction = page.locator('.shift-action-card').first()
  await expect(careAction).toBeVisible()
  expect((await careAction.boundingBox())?.height).toBeGreaterThanOrEqual(48)
  await careAction.tap()
  await expect(page.locator('.modal[role="dialog"]')).toBeVisible()
  await expect(page.locator('.patient-safety-identity')).toContainText('Hassan Abbasi')
  await page.locator('.modal-close').tap()

  const medicationAction = page.locator('.shift-action-card.medication').first()
  await expect(medicationAction).toBeVisible()
  await medicationAction.tap()
  await expect(page.getByText('پیش از مصرف تأیید کنید')).toBeVisible()
  await expect(page.locator('.verification-list input')).toHaveCount(5)
  await page.locator('.modal-close').tap()

  await page.goto('/app/schedule')
  const calendarEvent = page.locator('.agenda-event').first()
  await expect(calendarEvent).toBeVisible()
  await calendarEvent.tap()
  await expect(page.locator('.calendar-event-drawer')).toBeVisible()
  await page.locator('.calendar-event-drawer .modal-close').tap()
})
