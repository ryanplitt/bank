# Bank

A real-time multiplayer **Bank** dice game — the push-your-luck party game where one
person hosts the room *and plays too*, and everyone else joins from their own phone.

**Bank** is played with **2 dice** and a **shared pot**. Everyone in the round is in
play at the same time: the server rolls on a countdown, and each player individually
decides when to "bank out" and take the current pot. Roll past the safe opening rolls
and hit a 7 and the pot is wiped for everyone still in. So when do you bank?

## The rules

- **2 dice** are rolled automatically on a countdown (default 8s).
- The first `3` rolls of a round are **safe**:
  - a **7** pays a `70` bonus into the pot,
  - **doubles** add their face sum,
  - anything else adds its face sum.
- From the 4th roll on, the pressure is on:
  - a **7 ends the round and wipes the pot** for everyone still in,
  - **doubles double the pot**,
  - anything else adds its face sum.
- **Banking** takes the current pot *in full* into your permanent score and puts you
  out for the round. Everyone who banks gets the full pot — banking doesn't reduce it.
- The round ends when a 7 lands or everyone has banked.
- Highest total after **15 rounds** wins; ties share the win.

All defaults (rounds, safe-rolls, bonus, roll interval, doubles behaviour) are
adjustable by the host at creation.

## Playing

1. The **host** opens the app, enters their name, and taps **Host a new room**. They get
   a 6-letter room code and a shareable link.
2. Everyone else opens the app on their phone, enters their name and the code
   (or taps the share link).
3. The host taps **Start game** once the table is full (2–12 players).
4. Dice roll automatically. **Tap BANK** when the pot looks good to you. The host
   leads the game but plays just like everyone else — they can also set rules, kick or
   rename players, adjust a score, force a roll/advance, or end the game.

A phone that locks its screen or a browser refresh doesn't lose anything: players are
kept on the roster (shown greyed-out) with their score intact, and rejoin with a stored
session token. The host role is preserved across a quick refresh, and transfers to the
next player if the host is gone too long.

## Getting started (development)

Requires Node 22.

```bash
npm install
npm run dev
```

That runs both the API server and the Vite client together from the repo root. The
client is served at `http://localhost:5173` and proxies `/socket.io` to the API, so
everything talks to one origin. To play with friends locally, they open the same URL
from their phones on your wifi.

Other scripts:

- `npm test` — Vitest unit + integration tests (engine rules, fuzzing, the room/identity
  layer, and malformed-input hardening).
- `npm run e2e` — Playwright smoke tests driving three real browsers through a full game.
- `npm run lint` / `npm run format` — ESLint + Prettier.
- `npm run build && npm start` — build the client and run the server that serves it.

## Deploying

The server serves the built client *and* the WebSocket from a single port, so there is
exactly one container to run.

```bash
docker build -t bank .
docker run --rm -p 8080:8080 -e PORT=8080 bank
```

`fly.toml` is included (Render/Railway consume the same Dockerfile).

> **Scale to exactly one machine.** All game state is in-memory and Socket.IO needs
> session affinity, so Bank **must** run on a single Fly machine. If more than one
> machine ever serves traffic, the host's socket lands on one and a joiner's on another,
> so the joiner sees **"no game with that code"** — the rooms simply don't exist on the
> machine they connected to. That is exactly what happens if Fly ever runs two machines.

```bash
# Deploy with HA disabled so Fly does NOT spin up a redundant standby machine.
# This is the critical flag: on first deploy (and after fly scale count 0),
# Fly's default is to create TWO machines, which fragments in-memory rooms.
npm run deploy            # == fly deploy --ha=false
# After any deploy, double-check the count is exactly one:
fly scale count 1 -a bank-yxkpxq --yes
fly scale show -a bank-yxkpxq     # COUNT must be 1
```

Fixing a live split (host can "host" but nobody can join): destroy the extra machine.

```bash
fly machines list -a bank-yxkpxq                # find the machines
fly scale count 1 -a bank-yxkpxq --yes          # kill the redundant one
```

If Bank ever needs horizontal scale, it requires the Socket.IO Redis adapter plus
externalized room state — deliberately out of scope.

### Configuration

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket port |
| `NODE_ENV` | (unset) | `production` tightens some behaviour |
| `SESSION_SECRET` | random per boot | Key for durable player tokens |

## How it's built

- **`BankGame/server/game/bank.js`** — the pure, exhaustively-tested rules engine. It has
  no sockets, no timers, and no randomness (dice are passed in), so the scoring bugs of
  the old prototype can't recur.
- **`BankGame/server/rooms/Room.js`** — the live state of one room: roster, durable host,
  auto-roll clock, and broadcasting, wrapped around the engine.
- **`BankGame/server/socket/handlers.js`** — a thin validate → authorize → delegate layer.
  Every host command re-checks server-side that the caller is actually the host.
- **`BankGame/client/src/state/useGame.js`** — the single socket subscription feeding a
  single versioned state snapshot, so the client can never disagree with itself.
- **`BankGame/shared/`** — socket event names and the rule schema, shared by both sides.

## Project layout

```
├── BankGame/
│   ├── client/       React + Vite (mobile-first)
│   ├── server/       Express + Socket.IO, the engine, rooms, handlers
│   └── shared/       Event-name and rule constants used by both
├── e2e/              Playwright end-to-end specs
├── .github/          CI workflow (lint + test + build + docker build)
├── Dockerfile        Multi-stage: build client → serve from server
└── fly.toml          Fly.io single-instance config
```

## License

MIT
