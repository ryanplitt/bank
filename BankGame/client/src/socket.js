import { io } from 'socket.io-client';

/**
 * One shared socket connection to the current origin.
 *
 * In development the Vite dev server proxies /socket.io to the API, and in
 * production the server serves the built client and the socket on the same
 * origin — so `io()` with no URL just works in both and never needs CORS.
 *
 * The single instance is important: the whole client subscribes through
 * useGame to this one socket, so listeners are never torn down and re-attached
 * on every keystroke the way the old JoinForm did.
 */

const socket = io({
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
});

export default socket;
