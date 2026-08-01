import { defineConfig, devices } from '@playwright/test'

const tabletBrowserOverride = process.env.PLAYWRIGHT_TABLET_BROWSER === 'chromium'
  ? { browserName: 'chromium' as const }
  : {}

export default defineConfig({
  testDir: '.',
  testIgnore: process.env.CI ? ['visual.spec.ts'] : [],
  // A full locale review deliberately visits every care screen and waits for
  // their API-backed empty/loading states. Keep CI deterministic on a local
  // development database rather than failing a healthy walkthrough at 45s.
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['github']] : 'list',
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'caregiver-tablet', use: { ...devices['iPad (gen 7)'], ...tabletBrowserOverride } },
  ],
  webServer: [
    { command: 'python backend/manage.py migrate && python backend/manage.py seed_demo && python backend/manage.py runserver 127.0.0.1:8000', cwd: '..', port: 8000, reuseExistingServer: !process.env.CI, timeout: 120_000 },
    { command: 'npm run dev -- --host 127.0.0.1', cwd: '..', port: 5173, reuseExistingServer: !process.env.CI, timeout: 120_000 },
  ],
})
