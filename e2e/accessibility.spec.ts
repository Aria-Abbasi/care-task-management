import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

for (const route of ['today', 'schedule', 'medications', 'health', 'messages', 'settings']) {
  test(`${route} has no serious automated accessibility violations`, async ({ page }) => {
    await signIn(page)
    await page.goto(`/app/${route}`)
    await page.locator('#main-content').waitFor()
    const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze()
    expect(results.violations.filter((item) => ['serious', 'critical'].includes(item.impact || ''))).toEqual([])
  })
}
