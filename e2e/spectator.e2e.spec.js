import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end smoke test for read-only spectators: boots the real server,
 * seats a host and a player, starts the game, then opens the room link in a
 * third, nameless browser context. The watcher should get the live scoreboard
 * and feed with a muted, disabled BANK button — no roster seat, no session.
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

test('a spectator opens the room link and watches the game read-only', async ({ browser }) => {
  const host = await browser.newContext();
  const hostPage = await host.newPage();
  const code = await createHost(hostPage);

  const p2 = await browser.newContext();
  const p2Page = await p2.newPage();
  await joinGame(p2Page, 'Brie', code);

  await hostPage.waitForFunction(
    () => document.querySelectorAll('.scoreboard .row .name').length >= 2,
    undefined,
    { timeout: WAIT },
  );

  // Host starts the game while it is fresh.
  await hostPage.getByRole('button', { name: /Start game/ }).click();
  await hostPage.waitForSelector('.board', { timeout: WAIT });

  // A third context opens the bare room link and picks "Watch a game" — no
  // name, no join. The join screen should prefill the code from ?room=.
  const viewer = await browser.newContext();
  const viewerPage = await viewer.newPage();
  await viewerPage.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
  const watchButton = viewerPage.getByRole('button', { name: /Watch a game/ });
  await expect(watchButton).toBeVisible();
  await expect(viewerPage.locator('input[placeholder="ABC234"]')).toHaveValue(code);
  await watchButton.click();

  // The board shows up wrapped in the spectator chrome.
  await viewerPage.waitForSelector('.board.is-spectator .spectator-banner', { timeout: WAIT });
  await expect(viewerPage.locator('.spectator-banner')).toContainText(/watching 📡/);

  // The live scoreboard and feed render, and the watcher holds no seat.
  await viewerPage.waitForFunction(
    () => document.querySelectorAll('.scoreboard .row .name').length >= 2,
    undefined,
    { timeout: WAIT },
  );
  const watcherlessRows = await viewerPage.locator('.scoreboard .row');
  expect((await watcherlessRows.count())).toBe(2); // Host + Brie only

  // The countdown keeps running — for a spectator it is the show.
  await expect(viewerPage.locator('.countdown')).toBeVisible();

  // A BANK button exists but is muted and disabled: no active bank control.
  const bank = viewerPage.locator('.bank-button');
  await expect(bank).toBeVisible();
  await expect(bank).toBeDisabled();
  await expect(bank).toHaveClass(/muted/);

  await host.close();
  await p2.close();
  await viewer.close();
});
