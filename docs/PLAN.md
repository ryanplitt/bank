# Bank — Maintainer's Guide

This file began life as an evaluation plan for tearing down a dead, Farkle-based
prototype (it even references source files that no longer exist). That teardown is
long since executed: every gap it diagnosed has been closed. It is rewritten here
as a map of the system **as it stands today**, aimed at a maintainer opening the
codebase for the first time. User-facing setup instructions and the pitch live in
`README.md`; this doc is about the code.

## What Bank is

Bank is a real-time multiplayer push-your-luck dice game: one host runs the table
from a desktop — and plays as an ordinary player alongside everyone — while each
other player joins from their own phone via a shareable room code. The server
rolls on a countdown, a communal pot grows roll by roll, and each player
separately decides when to "bank" — lock in the pot and leave the round. There
are no turns; everyone at the table is in play at the same time, which is
exactly why a host can run the game without refereeing one.

## Rules, briefly

- **2 dice**, rolled automatically on a server-driven countdown (default 8s).
- The first **3 rolls** of a round are **safe**: a 7 pays a **+70** bonus into
  the pot, doubles add their face sum, anything else adds its sum.
- From the **4th roll** on, the pressure is on: a **7 busts the round** — it
  ends immediately and wipes the pot for everyone still in — doubles **double
  the pot**, anything else adds its sum.
- **Banking** pays the current pot _in full_; it never reduces the pot for the
  other players. The banker is out for the rest of the round.
- A round ends on a busting 7, or when **everyone has banked**.
- After **15 rounds** the player with the most points wins; **tied players
  share the win**.

All of this is host-adjustable at room creation (rounds count, safe rolls,
bonus, roll interval, doubles behaviour).

## How it's put together

The codebase is three npm workspaces — `BankGame/server`, `BankGame/client`,
`BankGame/shared` — plus root-level tooling (`e2e/`, CI, Dockerfile, `srvprobe.mjs`).

| Path                                   | Role                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BankGame/server/game/bank.js`         | The pure rules engine: `createGame`, `applyRoll`, `bankPlayer`, round/game lifecycle. No sockets, no timers, no randomness — dice are passed in. That purity is what makes the rules exhaustively unit-testable (including a seeded-RNG mode) and what keeps the scoring bugs of the old prototype from ever recurring. |
| `BankGame/server/rooms/Room.js`        | Live state of one room, wrapped around the engine: the roster (id → name plus connection presence — disconnects mark a player greyed-out but never delete them), durable host identity, and the auto-roll clock.                                                                                                        |
| `BankGame/server/rooms/RoomManager.js` | `code → Room` map with a TTL sweeper that reaps abandoned rooms, so a long-lived server never accumulates dead rooms.                                                                                                                                                                                                   |
| `BankGame/server/socket/handlers.js`   | Thin translate layer: **validate → authorize → delegate to the room → room broadcasts**. Handlers never mutate game state directly, and every host command is re-authorized server-side from the session token — never a socket id, never a client-sent `isHost`.                                                       |
| `BankGame/client/src/state/useGame.js` | The single socket subscription feeding a single versioned state snapshot. The client _replaces_ its state on every update rather than merging, which is what kills the "two sources of truth" class of bugs.                                                                                                            |
| `BankGame/shared/`                     | Socket event-name constants and the rule schema/defaults, imported by both sides so client and server cannot drift apart on the wire protocol.                                                                                                                                                                          |

Supporting cast worth knowing about: `BankGame/server/index.js` wires HTTP +
Socket.IO + static serving of the built SPA, reads config from the environment,
and exposes `GET /healthz`. `BankGame/server/utils/generateGameCode.js`
generates the 6-letter room codes. `srvprobe.mjs` (repo root) is a zero-dependency
diagnostic probe that drives memory-leak scenarios (duplicate sockets, abandoned
rooms) straight against the room layer — handy when the room/presence code is
under suspicion and you don't want a browser in the loop.

## Development

Requires Node 22. Everything runs from the repo root.

```bash
npm install     # once — npm workspaces pull in all three packages
npm run dev     # client (Vite, :5173) and server together; /socket.io is proxied
npm test        # Vitest unit + integration: engine rules, seeded-RNG fuzzing, hardening
npm run e2e     # Playwright: builds the client, then three real browsers play a full game
npm run lint    # ESLint, whole repo — must pass before committing
npm run format  # Prettier (single quotes, trailing commas, 100 columns)

npm run build && npm start   # production mode: build the SPA, then serve it from the server
```

Two notes on the e2e suite: each spec boots its own server instance on a fixed
port and drives it for a full game, so it needs the built client — running
`npx playwright test` directly is fine **only after** `npm run build` (which is
what `npm run e2e` does for you, and what CI does by ordering the steps).

## Deploying

There is exactly one deployable artifact: a single container in which the server
serves the built client _and_ the WebSocket on one port (`Dockerfile`,
`fly.toml`; Render/Railway consume the same Dockerfile).

- `GET /healthz` answers 200 — point the platform's health check at it.
- Configuration comes from the environment:

| Env var          | Default         | Purpose                                     |
| ---------------- | --------------- | ------------------------------------------- |
| `PORT`           | `3000`          | HTTP + WebSocket port                       |
| `NODE_ENV`       | unset           | set to `production` for tightened behaviour |
| `SESSION_SECRET` | random per boot | key for durable player rejoin tokens        |

- On Fly: `npm run deploy` is an alias for `fly deploy --ha=false`, and the
  `--ha=false` matters. State is in-memory and a socket is routed to exactly one
  machine; with a redundant standby machine running, a player can land on the
  machine that holds no rooms and see "no game with that code". After deploying,
  sanity-check `fly scale show` reports COUNT 1 (`fly scale count 1` recovers a
  split).

## Known limitations today

- **Single machine only.** There is no Redis adapter; in-memory rooms and
  Socket.IO's session affinity mean running two containers is worse than
  running one. This is a deliberate scope cut, not an oversight.
- **State is ephemeral.** Everything lives in process memory — a restart wipes
  every room, and player rejoin tokens only work while that process is alive.

## Possible future work

None of this is started; listed because each is a coherent, independently
land-able follow-up.

- **Scale out:** the Socket.IO Redis adapter plus externalized room state
  (database-backed rooms). The natural answer if the single-machine ceiling is
  ever hit; a big change, deliberately not sneaked into the current codebase.
- **Sound:** the client plays no audio at all today — dice, bank, and bust cues
  would be cheap atmosphere on a party table.
- **Spectator mode:** an observer role that watches a room's state feed without
  joining the roster or taking a seat.
- **PWA hardening:** `index.html` already ships the mobile-web-app meta tags,
  but there is no `manifest.json` (icons, launch name, display mode) and no
  service worker. Both would make the game properly installable and more
  tolerant of flaky table wifi.
