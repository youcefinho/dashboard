import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Note : `testDir` reste global pour rétro-compat. Les projects ci-dessous
  // override le testDir (visual = ./tests/visual, smoke = ./tests/e2e).
  testDir: './tests',
  outputDir: './tests/results',
  snapshotDir: './tests/__screenshots__',
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',

  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [
    // Sprint 35 vague 35-1D — smoke E2E (5 flows critiques avant beta)
    {
      name: 'smoke',
      testDir: './tests/e2e',
      use: { browserName: 'chromium' },
    },
    // Snapshots visuels (existant — Sprint précédents)
    {
      name: 'chromium',
      testDir: './tests/visual',
      use: { browserName: 'chromium' },
    },
    // Sprint 50 M1.2 — cross-browser visual regression.
    // webkit ≈ Safari (desktop), firefox = Gecko, mobile-safari = iOS.
    // Snapshots séparés par projet (Playwright suffixe -{projectName}).
    {
      name: 'webkit',
      testDir: './tests/visual',
      use: { browserName: 'webkit' },
    },
    {
      name: 'firefox',
      testDir: './tests/visual',
      use: { browserName: 'firefox' },
    },
    {
      name: 'mobile-safari',
      testDir: './tests/visual',
      use: { ...devices['iPhone 14'] },
    },
  ],

  webServer: {
    command: 'bun run preview',
    port: 4173,
    reuseExistingServer: true,
    timeout: 15_000,
  },

  // Pas de parallélisme pour snapshots (stabilité)
  workers: 1,
  retries: 0,

  // Tolérance pixel pour les différences mineures (fonts, anti-aliasing)
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
});
