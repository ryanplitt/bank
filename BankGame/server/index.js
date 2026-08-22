/**
 * Bank server entry point.
 *
 * Single process, single port: it serves the built client (express.static with
 * an SPA fallback) AND the Socket.IO upgrade on the same origin, so browsers
 * never need CORS and there is exactly one thing to deploy. All game state is
 * in-memory — this intentionally runs at exactly one instance (see docs/PLAN.md).
 *
 * Config comes from the environment:
 *   PORT            (default 3000)
 *   NODE_ENV        (production disables permissive dev extras)
 *   SESSION_SECRET  (optional; random per boot otherwise)
 */

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { registerHandlers } from './socket/handlers.js';
import { configureSession } from './utils/session.js';
import { logger } from './utils/log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

configureSession(process.env.SESSION_SECRET);

const app = express();
app.use(helmet({ contentSecurityPolicy: false })); // CSP relaxed for the SPA bundle + inline favicon
app.disable('x-powered-by');

// Health endpoint the orchestrator can hit without a WebSocket round trip.
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// Serve the built client. In dev the Vite dev server proxies /socket.io and
// /healthz here, so this only matters for `npm run build && npm start`.
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: unknown routes serve index.html so client-side paths work.
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text').send('Bank server running. Build the client (npm run build) to serve it here.');
  });
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  maxHttpBufferSize: 1e6, // 1 MB — plenty for our small payloads, a flood guard
});

registerHandlers(io);

httpServer.listen(PORT, () => {
  logger.info({ event: 'listen', port: PORT, env: isProd ? 'production' : 'development' });
});

/* -------------------------------------------------------------------- *
 * Process hardening
 * -------------------------------------------------------------------- */

// A single bad request should never take the whole room down with it. We log
// and keep serving; the handlers already translate throws into error events.
process.on('uncaughtException', (err) => {
  logger.error({ event: 'uncaught_exception', message: err.stack || String(err) });
});

process.on('unhandledRejection', (reason) => {
  logger.error({ event: 'unhandled_rejection', message: String(reason) });
});

/** Graceful shutdown: notify clients, stop accepting, then exit. */
function shutdown(signal) {
  logger.info({ event: 'shutdown', signal });
  io.close();
  httpServer.close(() => {
    process.exit(0);
  });
  // Never hang forever waiting on sockets.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
