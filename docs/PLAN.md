# Bank — Evaluation & Rebuild Plan

## Context

`ryanplitt/bank` is a stalled 4-commit prototype (17 files, ~800 lines of hand-written code). The
goal was a party game where **one admin leads the game but also plays**, and others join from their
own devices. The current code does not deliver that, and does not run at all.

### Verdict: three blockers, then a pile of correctness bugs

**1. The client cannot start.** There is no `index.html` anywhere in the repo, and there never was
one in git history. Vite's entry point for `BankGame/client` is missing, so `npm run dev` fails
immediately with "Could not resolve entry module index.html". `main.jsx` mounts into
`document.getElementById('root')`, an element that no file creates. Nobody has ever run this.

**2. It implements the wrong game.** `README.md` describes "the classic Bank dice game," but
`GameState.js` implements **Farkle**: 6 dice, strictly rotating turns, 1s = 100 / 5s = 50 / triples,
bust on a scoreless roll, first to 10,000. Bank is a fundamentally different game — 2 dice, a
*communal pot*, everyone in the round simultaneously, each player individually choosing when to
"bank out." The turn-rotation architecture in `GameState.js` and the `startTurnTimer` loop in
`index.js` have no counterpart in Bank and get discarded.

The Farkle structure is also *why* the admin idea never materialized: in a strict turn-rotation game
there is nothing for a leader to lead.

**3. It cannot be deployed.** `PORT = 3000` and CORS `origin: 'http://localhost:5173'` are
hardcoded in `BankGame/server/index.js:8-16`. No `process.env` reads, no static serving of the built
client, no Dockerfile, no health endpoint, no graceful shutdown.

### Correctness bugs verified by reading the code

| # | Bug | Location |
|---|---|---|
| 1 | **Banked scores are exactly 2× correct.** The handler adds `score` to *both* `currentTurnScore` and `player.score`; `bankScore()` then adds them together. | `index.js:130-131` + `GameState.js:141` |
| 2 | **"End Turn" doesn't forfeit turn points.** It calls `nextPlayer()`, which never resets `player.score`. Points survive and get banked later. README says they should be lost. | `index.js:180` |
| 3 | **Server crashes on an empty room.** `bustTurn()` does `this.getCurrentPlayer().score = 0` with no guard. Fired from inside a `setInterval`, an empty room throws a TypeError that takes down the whole Node process — every other game with it. | `GameState.js:157` |
| 4 | `nextPlayer()` does `% this.players.length` → `NaN` when the last player leaves. | `GameState.js:99` |
| 5 | **Disconnecting deletes you and your score.** `removePlayer` splices the array. A phone locking its screen or a browser refresh wipes the player out permanently. README's "Players can rejoin if disconnected" is false — no rejoin path exists. | `GameState.js:37` |
| 6 | **Host identity is a socket id.** Host refreshes → they are no longer host, and it silently transfers to `players[0]`. Directly defeats the admin requirement. | `GameState.js:26,53` |
| 7 | **Rooms leak.** `createGame` inserts into `games{}` *before* anyone joins. A creator who closes the tab leaves an immortal entry. No TTL, no sweeper. | `index.js:69-77` |
| 8 | **Duplicate names break turn ownership.** The client computes `isMyTurn` by comparing name *strings*. Two players named "Ryan" both get the controls. No uniqueness check exists. | `Lobby.jsx:96` |
| 9 | Turn timer `setInterval` broadcasts to the entire room once per second, and is reset to a full 30s by *any* player's disconnect. | `index.js:34-56`, `index.js:200` |
| 10 | No input validation anywhere: names unbounded/empty/whitespace, codes not normalized server-side (client uppercases, server doesn't), no player cap, no rate limits, no payload size limit. | `index.js` throughout |
| 11 | Timeout path calls `bustTurn()` but emits no event — clients see the turn change with no explanation. | `index.js:48-50` |
| 12 | Two sources of truth on the client: `players` (name strings) and `gameState.players` (objects). `playerJoined` doubles as the disconnect event. `setGameState(prev => ({...prev, ...state}))` merges partials, leaving stale fields. | `Lobby.jsx:22-32` |
| 13 | `JoinForm`'s `useEffect` lists `name`/`code` as deps, tearing down and re-registering socket listeners **on every keystroke**, and matches its own join via `players.includes(name)` — racy and wrong with duplicate names. | `JoinForm.jsx:11-49` |

### Everything else that's missing

No tests. No linting or formatting. No CI. No root `package.json` (you cannot install or run the
project with one command). No `engines`/`.nvmrc`. No LICENSE. `.vscode/launch.json:22` references a
`preLaunchTask` named "Install Dependencies" that doesn't exist (the real task is "Install All
Dependencies"). The README documents Farkle rules and a persistence feature that isn't there.

### Bottom line

The scaffolding — Vite + React, Express + Socket.IO, room codes — is a reasonable skeleton, and
`utils/generateGameCode.js` is genuinely fine (its alphabet already excludes I/O/0/1). Everything
game-related gets replaced. This is a small-to-medium rebuild on top of an existing skeleton, not a
salvage job and not a from-scratch project.

---

## Decisions (confirmed)

- **Game:** real Bank. 2 dice, communal pot, bank out individually.
- **Defaults (all host-adjustable at creation):** 15 rounds. Rolls 1–3 of a round are "safe" — a 7
  adds **70** to the pot, doubles add their face sum. From roll 4 on — a 7 **ends the round and
  wipes the pot** for everyone still in; doubles **double the pot**. Any other roll adds its sum.
  Banking takes the current pot into your permanent score and puts you out for that round. Round
  ends on a 7 or when everyone has banked. Highest total after 15 rounds wins; ties share the win.
- **Pacing:** server auto-rolls on a countdown (default 8s, host-adjustable). Players tap BANK
  during the window.
- **Dice:** the app rolls them.
- **Admin:** plays as a normal player, *plus* start/end game, set rules, kick/rename, manually
  adjust a score, force-roll, force-advance. Host role survives refresh and is transferable.
- **Stack:** stay JavaScript (ESM). Add Vitest. No TypeScript.
- **Deploy:** single container — server serves the built client and the WebSocket on one port.
  In-memory state, no database.

---

## Target architecture

Root npm workspaces, so `npm install && npm run dev` works from the repo root. Existing directory
paths are kept to preserve git history.

```
package.json                      NEW  workspaces + dev/build/test/lint scripts
Dockerfile                        NEW  multi-stage: build client → serve from server
fly.toml                          NEW  (Render/Railway also consume the Dockerfile)
.github/workflows/ci.yml          NEW  lint + test + build on push
BankGame/shared/
  events.js                       NEW  socket event-name constants, imported by BOTH sides
BankGame/server/
  index.js                        REWRITE  env config, static serving, /healthz, graceful shutdown
  config.js                       NEW  PORT, CLIENT_ORIGIN, SESSION_SECRET, rule defaults
  game/bank.js                    NEW  PURE rules engine — replaces GameState.js
  game/bank.test.js               NEW
  game/ruleConfig.js              NEW  preset + validation of host-chosen rules
  rooms/Room.js                   NEW  players, host, connection state, roll scheduling
  rooms/RoomManager.js            NEW  code→Room, TTL sweeper
  socket/handlers.js              NEW  thin: authenticate → validate → engine → broadcast
  utils/generateGameCode.js       KEEP AS IS
  utils/validate.js               NEW  name/code/config sanitization
  utils/session.js                NEW  HMAC player tokens
  game/GameState.js               DELETE  (Farkle)
BankGame/client/
  index.html                      NEW  ← the missing entry point
  src/session.js                  NEW  playerId + token in localStorage
  src/state/useGame.js            NEW  single socket subscription, one state object
  src/components/JoinScreen.jsx   REWRITE of JoinForm.jsx
  src/components/Lobby.jsx        REWRITE
  src/components/{GameBoard,Scoreboard,RollFeed,BankButton,Countdown,HostPanel}.jsx   NEW
  src/styles.css                  NEW  mobile-first
```

Four design choices that fix whole *classes* of the bugs above:

1. **Pure engine.** `bank.js` exports `createGame(config)`, `applyRoll(state, dice)`,
   `bankPlayer(state, playerId)`, `endRound(state)`, `isGameOver(state)` — no sockets, no timers, no
   `Math.random` (RNG injected). This makes the rules exhaustively testable and is what stops bugs
   #1–#4 from recurring.
2. **Durable identity.** On first join the server issues a `playerId` (uuid) plus an HMAC token;
   the client stores both in `localStorage` and presents them on every connect. Reconnect rebinds
   the socket to the existing player. Disconnected players stay on the roster (shown greyed) with
   their score intact — never spliced out mid-game. Fixes #5, #6, #8.
3. **Deadline-based timing, not tick broadcasts.** State carries `nextRollAt` (epoch ms); the server
   fires one `setTimeout`. The client renders its own countdown. No per-second fan-out, and a
   reconnecting client is instantly correct. Fixes #9.
4. **Versioned full-state snapshots.** One `gameStateUpdate` carrying the complete state plus a
   monotonic `version`; the client *replaces* rather than merges. A separate append-only `events`
   feed drives the "Ryan banked 340" ticker. Shared event-name constants in `BankGame/shared/`
   prevent the client/server drift behind #12.

---

## Work plan

Six phases, each independently verifiable. Roughly in dependency order.

### Phase 0 — Make it run
Root `package.json` with workspaces and `dev`/`build`/`test`/`lint` scripts (`concurrently` for
dev). Add `BankGame/client/index.html`. Add `.nvmrc` + `engines` (Node 22). ESLint + Prettier.
Fix the bad `preLaunchTask` name in `.vscode/launch.json`. Read `PORT`/`CLIENT_ORIGIN` from env.
**Exit:** `npm install && npm run dev` at the root serves a page in the browser.

### Phase 1 — The Bank engine (pure, no networking)
Write `game/bank.js` and `game/ruleConfig.js`. Delete `game/GameState.js`. Vitest suite covering:
safe-roll 7 = 70; safe-roll doubles = sum; post-safe 7 wipes the pot and ends the round; post-safe
doubles double the pot; banking snapshots the pot and removes you from the round; a round ending
with players still in pays them nothing; the round auto-ends when everyone has banked; game ends
after round 15; tie handling; a seeded RNG produces reproducible games. Fuzz 10k random games
asserting invariants (pot ≥ 0, scores monotonic, round ≤ max).
**Exit:** `npm test` green, engine untouched by socket concerns.

### Phase 2 — Rooms, identity, host
`Room.js` / `RoomManager.js` / `utils/session.js` / `socket/handlers.js`. Join, rejoin-by-token,
host election and explicit transfer, disconnect marking (not deletion), roll scheduling via
`setTimeout`, room TTL sweeper (idle rooms reaped; fixes #7), and the host command set: start, set
rules, kick, rename, adjust score, force-roll, force-advance, end game. Every host command
authorization-checked server-side against `playerId`, never socket id or a client-sent `isHost`.
**Exit:** an integration test drives 3 socket.io clients through a full 15-round game, including a
mid-game disconnect and rejoin that preserves score and host role.

### Phase 3 — Client rebuild
`useGame.js` as the single socket subscription and single state object. `JoinScreen` (create/join,
name validation, shareable join link with the code prefilled). `Lobby` (roster, host rule controls,
start). `GameBoard`: big pot readout, dice, a countdown bar to the next roll, a large thumb-reachable
BANK button, per-player banked/in-round status, roll feed, round counter. `HostPanel` behind a
disclosure so the host's own play view stays clean. Game-over screen with final standings and
"play again" reusing the room. Mobile-first CSS — this is a phones-around-a-table game.
**Exit:** full game playable end to end across several browser windows.

### Phase 4 — Hardening
Name length ≤ 20 + control-char stripping + per-room uniqueness; server-side code normalization;
caps on players per room (12) and total rooms; per-socket token-bucket rate limiting; socket.io
`maxHttpBufferSize`; `helmet`; every handler wrapped so a throw can never kill the process;
`process.on('uncaughtException'/'unhandledRejection')` logging; structured logging with a room-code
field; `/healthz`; graceful SIGTERM shutdown that notifies connected clients.
**Exit:** a malformed-input test suite (empty/huge/duplicate names, bad codes, non-host commands,
commands out of phase, event floods) leaves the server up and the game consistent.

### Phase 5 — Deploy & docs
Multi-stage Dockerfile (build client → copy `dist` into the server image → `express.static` + SPA
fallback on one `process.env.PORT`). `fly.toml`. GitHub Actions running lint + test + build.
Rewrite `README.md` for the actual game, actual setup, and deployment.

> **Scaling constraint to bake into the docs:** state is in-memory and Socket.IO needs session
> affinity, so this runs at **exactly one instance**. Set Fly `min_machines_running = 1` and do not
> scale out. Going multi-instance later requires the Redis adapter + externalized room state —
> that's the natural follow-up if the app ever needs it, but it is deliberately out of scope now.

**Exit:** deployed URL, joinable from phones on cellular, survives a redeploy cleanly.

---

## Verification

- **Unit:** `npm test` — engine rules, fuzz invariants, validation helpers.
- **Integration:** Vitest spinning a real server and 3 `socket.io-client` connections; asserts a
  full game, a disconnect/rejoin preserving score and host, and host commands rejected for non-hosts.
- **E2E smoke:** Playwright (Chromium is available in this environment) driving 3 browser contexts
  through create → join → play → game over.
- **Manual:** `npm run dev`, open on a laptop plus two phones on the same wifi; mid-game, lock a
  phone and reopen it to confirm the player rejoins with their score and the round intact; kill the
  host's tab and confirm the game continues and host transfer works.
- **Deploy check:** `docker build` locally, run the image with only `PORT` set, confirm the client
  is served and sockets connect from a second device.

---

## Sizing

Phase 0 is an hour or two. Phases 1–2 are the substance (the engine and the identity/room layer are
where the real design work lives). Phase 3 is the largest by line count but the most mechanical.
Phases 4–5 are checklist work. Nothing here is speculative — every item traces to a specific defect
or a stated requirement above.

Phases 0–1 alone are worth landing on their own: they take the repo from "has never run" to "has a
correct, tested Bank engine," which is the point where the rest becomes routine.
