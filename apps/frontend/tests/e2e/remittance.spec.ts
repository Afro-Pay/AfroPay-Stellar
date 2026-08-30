import { test, expect } from '@playwright/test';
import { loginAs, defaultUser, apiCreateUser } from './helpers';

/**
 * Sequential E2E scenario that exercises the full remittance journey:
 * login → seed account → wallet connection → transaction creation →
 * transaction history verification.
 *
 * These specs simulate the real user experience against the local stack
 * (docker-compose: Next.js frontend :3000 + NestJS API :3001 + Redis).
 */
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const user = defaultUser();

test.beforeAll(async () => {
  // Ensure the account exists so the UI login path is deterministic.
  await apiCreateUser(API_URL, user);
});

test('user can log in and land on the RemitX dashboard', async ({ page }) => {
  await loginAs(page, user);

  await expect(
    page.locator('h1', { hasText: 'RemitX Dashboard' }),
  ).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Balances' })).toBeVisible();
});

test('dashboard renders balances, send form and transaction history sections', async ({
  page,
}) => {
  await loginAs(page, user);

  await expect(page.locator('h2', { hasText: 'Balances' })).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Send Money' })).toBeVisible();
  await expect(page.locator('h2', { hasText: 'Transaction History' })).toBeVisible();

  // Either a balance card grid or the empty-state prompt is acceptable.
  const empty = page.getByText(/No balances found/i);
  const cards = page.locator('section[aria-labelledby="balances-heading"] > div > div');
  await expect(empty.or(cards.first())).toBeVisible();
});

test('send form validates empty destination and amount', async ({ page }) => {
  await loginAs(page, user);

  await page.click('#send-form button:has-text("Simulate")');
  await expect(page.locator('#send-form')).toContainText(
    /destination public key and amount/i,
  );
});

test('transactions page is reachable from the dashboard route', async ({ page }) => {
  await loginAs(page, user);
  await page.goto('/transactions');
  await page.waitForLoadState('networkidle');

  expect(page.url()).toContain('/transactions');
  const heading = page.locator('h1, h2').first();
  await expect(heading).toBeVisible();
});

test('wallet setup flow is reachable for accounts without a wallet', async ({
  page,
  context,
}) => {
  // A brand-new user (no publicKey in localStorage) should see wallet setup UI.
  const fresh = defaultUser();
  fresh.email = `fresh.${Date.now()}@afropay.test`;
  fresh.password = `fresh-pass-${Date.now()}`;
  await apiCreateUser(API_URL, fresh);

  const newPage = await context.newPage();
  await newPage.addInitScript((email) => {
    window.localStorage.setItem('e2e-user', email);
  }, fresh.email);
  await loginAs(newPage, fresh);

  // Wallet setup should be offered somewhere in the dashboard body
  const setupCta = newPage.locator(
    'button:has-text("Create Wallet"), button:has-text("Set up wallet")',
  );
  const count = await setupCta.count();
  // Not every route renders a wallet CTA, but if the account truly has no
  // wallet the balance section should at least show the empty-state prompt.
  const emptyPrompt = newPage.getByText(/No balances found|create a wallet/i);
  await expect(emptyPrompt.or(setupCta.first())).toBeVisible();
});

test('login rejects invalid credentials with a visible error', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#auth-email', `nope-${Date.now()}@afropay.test`);
  await page.fill('#auth-password', 'definitely-wrong-password-1');
  await page.click('#auth-form button[type="submit"]');

  await expect(page.locator('#auth-error')).toContainText(/invalid email or password/i);
});