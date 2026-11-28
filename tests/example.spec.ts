import { test, expect, Page } from '@playwright/test';

const mockSession = async (page: Page) => {
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          name: 'Test DevOps Admin',
          email: 'admin@driftseeker.local',
          username: 'test-admin',
        },
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      }),
    });
  });
};

test.describe('Authentication & Access Control', () => {
  test('Landing page renders correctly for unauthenticated user', async ({ page }) => {
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'DriftSeeker: DevOps Guardian' })).toBeVisible();
    await expect(page.locator('text=Initializing search protocols')).toBeVisible();
  });

  test('Protected routes redirect to home if unauthenticated', async ({ page }) => {
    await page.route('**/api/auth/session', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/dashboard');
    await page.waitForURL('/');

    await expect(page.getByRole('heading', { name: 'DriftSeeker: DevOps Guardian' })).toBeVisible();
  });
});

test.describe('Dashboard & Monitors (Authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await mockSession(page);
    await page.route('**/api/github/repos', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/abtest/results*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] }),
      });
    });
  });

  test('Dashboard loads successfully with session', async ({ page }) => {
    await page.route('**/api/database', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('text=WAITING_FOR_SEQUENCE_INITIATION')).toBeVisible();
  });

  test('Monitors page fetches and displays web servers', async ({ page }) => {
    await page.route('**/api/database', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            _id: '1',
            url: 'https://google.com',
            name: 'Google Monitor',
            status: 'up',
            latency: 42,
            lastChecked: new Date().toISOString(),
          },
        ]),
      });
    });

    await page.goto('/monitors');
    await expect(page).toHaveURL('/monitors');
    await expect(page.locator('text=Google Monitor')).toBeVisible();
  });

  test('Check Status functionality on dashboard', async ({ page }) => {
    await page.route('**/api/database', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/check_status*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 200,
          message: 'Server Online',
        }),
      });
    });

    await page.goto('/dashboard');
    await page.fill('#target-url-input', 'https://fast.com');
    await page.keyboard.press('Enter');
    await expect(page.locator('text=Server Online')).toBeVisible();
  });
});
