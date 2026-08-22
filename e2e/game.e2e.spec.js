import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end smoke test: boots the real server (which serves the built client
 * and the Socket.IO endpoint on one origin), then drives three browser contexts
 * through create → join → start → play → bank → next round → end game.
 *
 * Requires `npm run build` to have its run first so client/dist exists.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5179;
const BASE = `http://localhost:${PORT}`;

let proc;

test.beforeAll(async () => {
  proc = spawn('node', ['BankGame/server/index.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  // Wait for the server to be ready.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not come up for e2e test');
});

test.afterAll(async () => {
  if (proc) proc.kill();
});

const WAIT = 20000;

async function createHost(page) {
  await page.goto(`${BASE}/?room=`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[placeholder="e.g. Ryan"]').fill('Host');
  await page.getByRole('button', { name: /Host a new room/ }).click();
  // The lobby shows the room code in the header once the session + state land.
  await page.waitForSelector('.lobby-head h2', { timeout: WAIT });
  const code = (await page.locator('.lobby-head h2').innerText()).replace('Room ', '').trim();
  return code;
}

async function joinGame(page, name, code) {
  await page.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[placeholder="e.g. Ryan"]').fill(name);
  await page.locator('input[placeholder="ABC234"]').fill(code);
  await page.getByRole('button', { name: /Join room/ }).click();
  await page.waitForSelector('.lobby-head h2', { timeout: WAIT });
}

test('create → join → start → play → bank → next round → end', async ({ browser }) => {
  const host = await browser.newContext();
  const hostPage = await host.newPage();
  const code = await createHost(hostPage);

  const p2 = await browser.newContext();
  const p2Page = await p2.newPage();
  await joinGame(p2Page, 'Brie', code);

  const p3 = await browser.newContext();
  const p3Page = await p3.newPage();
  await joinGame(p3Page, 'Charlie', code);

  // The host sees all three.
  await hostPage.waitForFunction(
    () => document.querySelectorAll('.scoreboard .row .name').length >= 3,
    undefined,
    { timeout: WAIT },
  );

  // Host starts the game.
  await hostPage.getByRole('button', { name: /Start game/ }).click();
  await hostPage.waitForSelector('.board', { timeout: WAIT });
  await p2Page.waitForSelector('.board', { timeout: WAIT });
  await p3Page.waitForSelector('.board', { timeout: WAIT });

  // Round begins; everyone is in and there's a countdown.
  await expect(hostPage.locator('.round')).toContainText('Round 1');
  await expect(hostPage.locator('.pot-value')).toBeVisible();

  // Wait for / force the pot to be non-zero, then everyone banks.
  // The auto-roll will grow the pot; banking is available once pot > 0.
  await hostPage.waitForFunction(() => {
    const el = document.querySelector('.pot-value');
    return el && Number(el.textContent) > 0;
  }, undefined, { timeout: WAIT });

  const clickBank = (page) =>
    page.waitForFunction(() => {
      const b = document.querySelector('.bank-button');
      return b && !b.disabled;
    }, undefined, { timeout: WAIT }).then(() => page.locator('.bank-button').click());

  await clickBank(hostPage);
  // Host banked → out of round.
  await hostPage.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.scoreboard .row')];
    const host = rows.find((r) => r.querySelector('.name')?.textContent.includes('Host'));
    return host && host.textContent.includes('banked');
  }, undefined, { timeout: WAIT });

  await clickBank(p2Page);
  await clickBank(p3Page);

  // All banked → round is over → the host advances to round 2.
  await hostPage.waitForFunction(() => {
    const round = document.querySelector('.round');
    return round && round.textContent.includes('Round 1');
  }, undefined, { timeout: WAIT });
  await hostPage.getByText('Host controls').click();
  await hostPage.getByRole('button', { name: /Force end round/ }).click();
  await hostPage.waitForFunction(() => {
    const round = document.querySelector('.round');
    return round && round.textContent.includes('Round 2');
  }, undefined, { timeout: WAIT });

  // Host ends the game early to finish the smoke test quickly. The host panel
  // is already open from the force-end-round step above.
  await hostPage.getByRole('button', { name: /End game now/ }).click();
  await hostPage.waitForSelector('.gameover', { timeout: WAIT });
  await p3Page.waitForSelector('.gameover', { timeout: WAIT });
  await expect(hostPage.locator('.gameover h2')).toContainText('Game over');

  await host.close();
  await p2.close();
  await p3.close();
});

test('a reconnecting player resumes in place with their score', async ({ browser }) => {
  const a = await browser.newContext();
  const aPage = await a.newPage();
  const b = await browser.newContext();
  const bPage = await b.newPage();

  const code = await createHost(aPage);
  await joinGame(bPage, 'Brie', code);

  await aPage.getByRole('button', { name: /Start game/ }).click();
  await aPage.waitForSelector('.board', { timeout: WAIT });
  await bPage.waitForSelector('.board', { timeout: WAIT });
  await aPage.waitForFunction(() => {
    const el = document.querySelector('.pot-value');
    return el && Number(el.textContent) > 0;
  }, undefined, { timeout: WAIT });

  // Brie banks.
  await bPage.waitForFunction(() => {
    const b = document.querySelector('.bank-button');
    return b && !b.disabled;
  }, undefined, { timeout: WAIT });
  await bPage.locator('.bank-button').click();

  // Capture Brie's score from the host's view.
  const score = await aPage.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.scoreboard .row')];
    const brie = rows.find((r) => r.querySelector('.name')?.textContent.includes('Brie'));
    if (!brie) return undefined;
    const cells = brie.querySelectorAll('.score');
    return cells.length ? Number(cells[0].textContent) : undefined;
  }, undefined, { timeout: WAIT }).then(
    (h) => h.jsonValue(),
  );
  expect(score).toBeGreaterThan(0);

  // Simulate a phone locking: close the page (socket disconnects), then reopen
  // the same context so localStorage persists, and resume.
  await bPage.close();
  await aPage.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.scoreboard .row')];
    const brie = rows.find((r) => r.querySelector('.name')?.textContent.includes('Brie'));
    return brie && brie.textContent.includes('⋯'); // away marker
  }, undefined, { timeout: WAIT });

  const bPage2 = await b.newPage();
  await bPage2.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
  // Now the stored session should make the resume card appear.
  await bPage2.waitForSelector('.resume-card', { timeout: WAIT });
  await bPage2.getByRole('button', { name: /Resume/ }).click();
  await bPage2.waitForSelector('.board', { timeout: WAIT });
  // Brie's score survived the reconnect.
  await bPage2.waitForFunction((c) => {
    const rows = [...document.querySelectorAll('.scoreboard .row')];
    const brie = rows.find((r) => r.querySelector('.name')?.textContent.includes('Brie'));
    return brie && Number(brie.querySelector('.score').textContent) === c;
  }, score, { timeout: WAIT });

  await a.close();
  await b.close();
});
