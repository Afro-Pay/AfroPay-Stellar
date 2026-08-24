/**
 * Shared E2E helpers for the AfroPay remittance flow.
 *
 * Provides deterministic test credentials (seeded by the API test seeds) and
 * small wrappers over the Playwright browser API so both the sequential
 * `remittance.spec.ts` scenario and the concurrency stress runner share one
 * code path.
 */
import { Page, BrowserContext } from '@playwright/test';

/** Deterministic users provisioned by the stress-test seed script. */
export interface E2EUser {
  email: string;
  password: string;
  publicKey: string;
}

export function seededUsers(count: number): E2EUser[] {
  const users: E2EUser[] = [];
  for (let i = 1; i <= count; i += 1) {
    users.push({
      email: `stress.user.${i}@afropay.test`,
      password: `stress-pass-${i}-${String(i * 7919).padStart(6, '0')}`,
      publicKey: `GAFLW5Q7FCKJVVFY7GSRQC4DFCPGTVSY6CWYABDTU5D5U6M5FPNVTD${String(i).padStart(2, '0')}`,
    });
  }
  return users;
}

/** Standard user for the sequential (non-stress) E2E scenario. */
export function defaultUser(): E2EUser {
  return seededUsers(1)[0];
}

/**
 * Log into the frontend via the auth form. Assumes the account already exists
 * (created by the seed script / test API helper).
 */
export async function loginAs(page: Page, user: E2EUser): Promise<void> {
  await page.goto('/login');
  await page.fill('#auth-email', user.email);
  await page.fill('#auth-password', user.password);
  // The submit button is the single `type="submit"` inside #auth-form
  await page.click('#auth-form button[type="submit"]');
  await page.waitForURL('**/');
  await page.waitForSelector('h1:has-text("RemitX Dashboard")', { timeout: 15_000 });
}

/** Seed a user account against the NestJS API directly (bypasses the UI). */
export async function apiCreateUser(apiURL: string, user: E2EUser): Promise<string> {
  const registerRes = await fetch(`${apiURL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!registerRes.ok && registerRes.status !== 409) {
    throw new Error(
      `register failed for ${user.email}: ${registerRes.status} ${await registerRes.text()}`,
    );
  }
  const data = await registerRes.json().catch(() => ({}));
  return data?.access_token ?? '';
}

/** Login via API to obtain a bearer token (used by stress runner metrics). */
export async function apiLogin(apiURL: string, user: E2EUser): Promise<string> {
  const res = await fetch(`${apiURL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!res.ok) {
    throw new Error(`login failed for ${user.email}: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data?.access_token ?? '';
}

/**
 * Fill in the "Send Money" form and go through simulation → confirm.
 * Returns the URL that was reached (or the resolved page).
 */
export async function submitRemittance(page: Page, opts: {
  destination: string;
  amount: string;
  assetCode?: string;
  memo?: string;
}): Promise<void> {
  const assetCode = opts.assetCode ?? 'XLM';
  await page.fill('input[id="send-destination"]', opts.destination).catch(async () => {
    // Fallback selectors if the destination input id differs
    await page
      .fill('#send-form input[type="text"], #send-form input:not([type])', opts.destination);
  });
  await page.fill('input[id="send-amount"], #send-form input[type="number"]', opts.amount);

  // Asset picker — default XLM usually; switch if another code requested.
  if (assetCode !== 'XLM') {
    const picker = page.locator('#send-form [data-asset-code]').first();
    const count = await picker.count();
    if (count > 0) await picker.click();
  }

  if (opts.memo) {
    await page.fill('#send-memo, #send-form textarea', opts.memo);
  }

  // Click simulate/preview then confirm
  await page.click('#send-form button:has-text("Simulate"), #send-form button:has-text("Preview")');
  await page.waitForSelector('#send-form button:has-text("Confirm"), #send-form button:has-text("Send")', {
    timeout: 20_000,
  });
  await page.click('#send-form button:has-text("Confirm"), #send-form button:has-text("Send")');
  // Wait for success feedback or history page update
  await page.waitForSelector(
    'text=/transferred|sent successfully|Transaction.*created|pending/i',
    { timeout: 30_000 },
  );
}

/** Fresh context with a unique storage state per user (isolation for stress). */
export async function newUserContext(
  context: BrowserContext,
  user: E2EUser,
): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript((email) => {
    window.localStorage.setItem('e2e-user', email);
  }, user.email);
  return page;
}