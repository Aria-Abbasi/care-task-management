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

  const openSidebarIfMobile = async () => {
    const menuBtn = page.locator('.menu-button')
    if (await menuBtn.isVisible()) {
      await menuBtn.click()
    }
  }
  const closeSidebarIfMobile = async () => {
    const closeBtn = page.locator('.mobile-close')
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    }
  }

  await openSidebarIfMobile()
  await page.locator('.sidebar-profile-more').click()
  const sidebarAccountMenu = page.locator('.sidebar-account-menu')
  await expect(sidebarAccountMenu.getByText('Sarah James')).toBeVisible()
  await expect(sidebarAccountMenu.getByRole('menuitem', { name: 'Workspace settings' })).toBeVisible()
  await expect(sidebarAccountMenu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
  await page.locator('.sidebar-profile-more').click()
  await closeSidebarIfMobile()

  await page.getByRole('button', { name: 'Account' }).click()
  const accountMenu = page.getByRole('menu')
  await expect(accountMenu.getByText('Sarah James')).toBeVisible()
  await expect(accountMenu.getByRole('menuitem', { name: 'Workspace settings' })).toBeVisible()
  await expect(accountMenu.getByRole('menuitem', { name: 'Switch person receiving care' })).toBeVisible()
  await expect(accountMenu.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
  await expect(accountMenu.getByRole('menuitem', { name: 'Workspace settings' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(accountMenu).toBeHidden()
  await expect(page.getByRole('button', { name: 'Account' })).toBeFocused()

  await openSidebarIfMobile()
  await page.locator('.sidebar-profile-more').click()
  await expect(sidebarAccountMenu).toBeVisible()
  const backdrop = page.locator('.backdrop')
  if (await backdrop.isVisible()) {
    await backdrop.click({ position: { x: 10, y: 10 } })
  } else {
    await page.locator('#main-content').click({ position: { x: 300, y: 120 } })
  }
  await expect(sidebarAccountMenu).toBeHidden()
  await page.screenshot({ path: testInfo.outputPath('english-safety.png'), fullPage: true, animations: 'disabled' })
})

test('settings provides QR MFA enrollment and signed-in password change', async ({ page }) => {
  await signIn(page)
  await page.goto('/app/settings')
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible()
  await expect(page.getByLabel('Current password')).toBeVisible()
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Set up authenticator MFA' }).click()
  await expect(page.getByRole('img', { name: 'Scan this QR code with your authenticator app' })).toBeVisible()
  await expect(page.getByLabel('Six-digit verification code')).toBeVisible()
})
