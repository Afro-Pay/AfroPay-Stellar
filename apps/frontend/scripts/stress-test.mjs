#!/usr/bin/env node

/**
 * AfroPay-Stellar Concurrency Stress Runner
 * ==========================================
 *
 * Spins up N headless Playwright browser instances, each logged in as a
 * unique user, and submits a remittance transaction simultaneously to
 * stress-test the queue, database, and anchor services.
 *
 * Usage:
 *   node scripts/stress-test.mjs [options]
 *
 * Options:
 *   --concurrency <N>   Number of concurrent users (default: 50)
 *   --api-url <url>     API base URL (default: http://127.0.0.1:3001)
 *   --frontend-url <url> Frontend base URL (default: http://127.0.0.1:3000)
 *   --seed-only         Only seed users, do not run the browser stress test
 *   --report-dir <dir>  Output directory for the HTML report (default: stress-report)
 *
 * Requires:
 *   - Docker-compose stack (frontend :3000, API :3001, postgres, redis) running
 *   - Playwright browsers installed (npx playwright install chromium)
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ─────────────────────────────────────────────────────────────────
const CONCURRENCY = parseInt(process.env.STRESS_CONCURRENCY ?? '50', 10);
const API_URL = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const FRONTEND_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const REPORT_DIR = process.env.REPORT_DIR ?? resolve(__dirname, '..', 'stress-report');
const SEED_ONLY = process.argv.includes('--seed-only');

// ─── User Pool ───────────────────────────────────────────────────────────────
function generateUsers(n) {
  const users = [];
  for (let i = 1; i <= n; i += 1) {
    users.push({
      id: i,
      email: `stress.user.${i}@afropay.test`,
      password: `stress-pass-${i}-${String(i * 7919).padStart(6, '0')}`,
      destPublicKey: `GAFLW5Q7FCKJVVFY7GSRQC4DFCPGTVSY6CWYABDTU5D5U6M5FPNVTD${String(i).padStart(2, '0')}`,
    });
  }
  return users;
}

// ─── API helpers ─────────────────────────────────────────────────────────────
async function seedUser(user) {
  try {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    // 409 = already exists, harmless
    if (res.ok || res.status === 409) return true;
    console.error(`  [seed] ${user.email} → ${res.status}`);
    return false;
  } catch (err) {
    console.error(`  [seed] ${user.email} → network error: ${err.message}`);
    return false;
  }
}

async function loginUser(user) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  if (!res.ok) {
    throw new Error(`login: ${res.status} ${await res.text()}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchDBMetrics(token) {
  try {
    const res = await fetch(`${API_URL}/health`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return await res.json();
  } catch { /* best-effort */ }
  return null;
}

// ─── Browser Stress Runner ──────────────────────────────────────────────────
async function runConcurrentStress(users) {
  const browser = await chromium.launch({ headless: true });
  const results = [];

  // Run all user flows concurrently
  const promises = users.map(async (user) => {
    const startTime = Date.now();
    const steps = [];
    const record = (step, ok, detail) => steps.push({ step, ok, detail, ts: Date.now() });

    try {
      const context = await browser.newContext({
        baseURL: FRONTEND_URL,
        viewport: { width: 1280, height: 800 },
        locale: 'en-US',
      });

      const page = await context.newPage();
      record('context_created', true, '');

      // 1. Login
      await page.goto('/login', { waitUntil: 'networkidle', timeout: 30_000 });
      record('login_page_loaded', true, '');

      await page.fill('#auth-email', user.email);
      await page.fill('#auth-password', user.password);
      await page.click('#auth-form button[type="submit"]');
      await page.waitForURL('**/');
      await page.waitForSelector('h1:has-text("RemitX Dashboard")', { timeout: 15_000 });
      record('login_completed', true, '');

      // 2. Navigate to send form
      const sendForm = page.locator('#send-form');
      const sendFormVisible = (await sendForm.count()) > 0;
      if (!sendFormVisible) {
        record('send_form_visible', false, 'send-form not found on dashboard');
        await context.close();
        return { user: user.id, steps, totalMs: Date.now() - startTime };
      }
      record('send_form_visible', true, '');

      // 3. Fill and submit remittance
      const destInput = page.locator('#send-form input[type="text"], #send-form input:not([type])');
      await destInput.fill(user.destPublicKey);
      const amountInput = page.locator('#send-form input[type="number"]');
      await amountInput.fill('10.50');
      record('form_filled', true, '');

      // 4. Click simulate
      await page.click('#send-form button:has-text("Simulate")');
      await page.waitForSelector('#send-form button:has-text("Confirm"), #send-form button:has-text("Send")', {
        timeout: 20_000,
      });
      record('simulation_completed', true, '');

      // 5. Confirm send
      await page.click('#send-form button:has-text("Confirm"), #send-form button:has-text("Send")');
      await page.waitForSelector('text=/transferred|sent successfully|Transaction.*created|pending/i', {
        timeout: 30_000,
      });
      record('transfer_confirmed', true, '');

      await context.close();
    } catch (err) {
      record('error', false, err.message || String(err));
    }

    const elapsed = Date.now() - startTime;
    results.push({ user: user.id, steps, totalMs: elapsed });
    console.log(`  [user ${user.id}] ${elapsed}ms — ${steps.filter(s => s.ok).length}/${steps.length} steps ok`);
    return { user: user.id, steps, totalMs: elapsed };
  });

  await Promise.allSettled(promises);
  await browser.close();
  return results;
}

// ─── Report Generator ───────────────────────────────────────────────────────
function generateReport(results, startTime, endTime, dbBefore, dbAfter) {
  const totalDuration = endTime - startTime;
  const totalSteps = results.reduce((s, r) => s + r.steps.length, 0);
  const okSteps = results.reduce((s, r) => s + r.steps.filter(st => st.ok).length, 0);
  const failedSteps = totalSteps - okSteps;
  const succeeded = results.filter(r => r.steps.every(st => st.ok));
  const failed = results.filter(r => r.steps.some(st => !st.ok));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AfroPay-Stellar Stress Test Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
           background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
    .meta { color: #94a3b8; margin-bottom: 2rem; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
               gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.2rem; }
    .card .label { font-size: 0.8rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .card .value { font-size: 2rem; font-weight: 700; margin-top: 0.3rem; }
    .card .value.green { color: #22c55e; }
    .card .value.red { color: #ef4444; }
    .card .value.blue { color: #3b82f6; }
    .card .value.amber { color: #f59e0b; }

    .section { margin-top: 2rem; }
    .section h2 { font-size: 1.3rem; margin-bottom: 1rem; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th, td { padding: 0.6rem 0.8rem; text-align: left; border-bottom: 1px solid #1e293b; }
    th { color: #94a3b8; font-weight: 600; }
    .ok { color: #22c55e; }
    .fail { color: #ef4444; }
    .step-tag { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px;
                font-size: 0.75rem; margin: 0.1rem; }
    .step-ok { background: #166534; color: #bbf7d0; }
    .step-fail { background: #7f1d1d; color: #fecaca; }
    .db-table { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .db-table pre { background: #1e293b; padding: 1rem; border-radius: 8px; overflow-x: auto; font-size: 0.8rem; }
  </style>
</head>
<body>
  <h1>🧪 AfroPay-Stellar Stress Test Report</h1>
  <p class="meta">
    ${CONCURRENCY} concurrent users &middot;
    Started: ${new Date(startTime).toISOString()} &middot;
    Duration: ${(totalDuration / 1000).toFixed(1)}s
  </p>

  <div class="summary">
    <div class="card"><div class="label">Total Users</div><div class="value blue">${results.length}</div></div>
    <div class="card"><div class="label">Succeeded</div><div class="value green">${succeeded.length}</div></div>
    <div class="card"><div class="label">Failed</div><div class="value red">${failed.length}</div></div>
    <div class="card"><div class="label">Total Steps</div><div class="value amber">${totalSteps}</div></div>
    <div class="card"><div class="label">Passed Steps</div><div class="value green">${okSteps}</div></div>
    <div class="card"><div class="label">Failed Steps</div><div class="value red">${failedSteps}</div></div>
  </div>

  <div class="section">
    <h2>📊 Latency & Step Breakdown</h2>
    <table>
      <thead><tr><th>User</th><th>Duration (ms)</th><th>Steps</th><th>Status</th></tr></thead>
      <tbody>
        ${results.map(r => {
          const hasFail = r.steps.some(st => !st.ok);
          const stepTags = r.steps.map(st =>
            `<span class="step-tag ${st.ok ? 'step-ok' : 'step-fail'}">${st.step}</span>`
          ).join('');
          return `<tr>
            <td>#${r.user}</td>
            <td>${r.totalMs}</td>
            <td>${stepTags}</td>
            <td class="${hasFail ? 'fail' : 'ok'}">${hasFail ? '❌' : '✅'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>📈 DB & Health Metrics</h2>
    <div class="db-table">
      <div><h3>Before Run</h3><pre>${JSON.stringify(dbBefore ?? { note: 'not available' }, null, 2)}</pre></div>
      <div><h3>After Run</h3><pre>${JSON.stringify(dbAfter ?? { note: 'not available' }, null, 2)}</pre></div>
    </div>
  </div>

  <div class="section">
    <h2>❌ Failure Details</h2>
    ${failed.length === 0 ? '<p>No failures — all users completed the full flow.</p>' : ''}
    ${failed.map(f => {
      const failStep = f.steps.find(st => !st.ok);
      return `<div style="background:#1e293b;padding:0.8rem;border-radius:8px;margin-bottom:0.5rem">
        <strong>User #${f.user}</strong> — failed at step <code>${failStep?.step}</code>:
        <code style="color:#f87171">${failStep?.detail ?? 'unknown'}</code>
      </div>`;
    }).join('')}
  </div>
</body>
</html>`;

  mkdirSync(REPORT_DIR, { recursive: true });
  const htmlPath = resolve(REPORT_DIR, 'index.html');
  writeFileSync(htmlPath, html, 'utf-8');
  console.log(`\n📄 Report written to ${htmlPath}`);
  return htmlPath;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  AfroPay-Stellar Concurrency Stress Runner   ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Concurrency      : ${CONCURRENCY} users`);
  console.log(`  API URL          : ${API_URL}`);
  console.log(`  Frontend URL     : ${FRONTEND_URL}`);
  console.log(`  Report Directory : ${REPORT_DIR}`);
  console.log('');

  const users = generateUsers(CONCURRENCY);

  // Phase 1 — Seed all users
  console.log('[Phase 1] Seeding users…');
  const seedResults = await Promise.all(users.map(u => seedUser(u)));
  const seeded = seedResults.filter(Boolean).length;
  console.log(`  ${seeded}/${CONCURRENCY} users seeded (or already existed).`);
  console.log('');

  if (SEED_ONLY) {
    console.log('  --seed-only flag set, exiting.\n');
    process.exit(0);
  }

  // Phase 2 — Capture pre-run health
  console.log('[Phase 2] Capturing pre-run metrics…');
  const adminToken = await loginUser(users[0]).catch(() => null);
  const dbBefore = adminToken ? await fetchDBMetrics(adminToken) : null;
  const startTime = Date.now();

  // Phase 3 — Run concurrent stress
  console.log(`[Phase 3] Running ${CONCURRENCY} concurrent remittance flows…`);
  console.log('  (this may take a minute)');
  const results = await runConcurrentStress(users);

  // Phase 4 — Capture post-run health
  const endTime = Date.now();
  const dbAfter = adminToken ? await fetchDBMetrics(adminToken) : null;

  // Phase 5 — Generate report
  console.log('\n[Phase 4] Generating report…');
  const reportPath = generateReport(results, startTime, endTime, dbBefore, dbAfter);

  // Phase 6 — Summary
  const succeeded = results.filter(r => r.steps.every(st => st.ok));
  const failed = results.filter(r => r.steps.some(st => !st.ok));
  const avgDuration = results.reduce((s, r) => s + r.totalMs, 0) / results.length;

  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  STRESS TEST COMPLETE');
  console.log('');
  console.log(`  Total users       : ${results.length}`);
  console.log(`  Succeeded          : ${succeeded.length} ✅`);
  console.log(`  Failed             : ${failed.length} ${failed.length > 0 ? '❌' : '✅'}`);
  console.log(`  Average duration   : ${avgDuration.toFixed(0)}ms`);
  console.log(`  Total duration     : ${((endTime - startTime) / 1000).toFixed(1)}s`);
  if (failed.length > 0) {
    console.log(`  Failure rate       : ${(failed.length / results.length * 100).toFixed(1)}%`);
    console.log('  ⚠️  Review the HTML report for failure details.');
  } else {
    console.log('  🎉 No failures — DB & queue remained stable.');
  }
  console.log('═══════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});