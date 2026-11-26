/**
 * useGame.js — the single socket subscription and single source of game state.
 *
 * One hook, one shared socket, one state object. The server pushes *full*
 * versioned snapshots on `state` and the client *replaces* its previous state
 * rather than merging — which is exactly what kills the "two sources of truth"
 * and "stale merged fields" bugs in the old prototype.
 *
 * Deriving `players`, `me`, `isHost` etc. from that one snapshot means every
 * component sees the same coherent picture.
 *
 * Reconnection: socket.io reconnects with a brand-new server-side socket that
 * is in no room, so this hook re-attaches on every `connect` after the first —
 * resuming a seat, or re-watching — rather than leaving the board frozen.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket.js';
import { C2S, ERROR_CODES, isBankingLocked } from '@bank/shared';
import { saveIdentity, clearIdentity } from '../session.js';

/** Errors that mean a resume can never succeed: stop trying and start clean. */
const FATAL_RESUME_ERRORS = new Set([
  ERROR_CODES.NO_SUCH_GAME,
  ERROR_CODES.SESSION_EXPIRED,
  ERROR_CODES.NOT_IN_GAME,
]);

const REMOVED_MESSAGES = {
  kicked: 'The host removed you from the game.',
  default: 'That game has ended.',
};

export function useGame() {
  const [state, setState] = useState(null);
  const [session, setSession] = useState(null);
  const [feed, setFeed] = useState([]);
  const [lastError, setLastError] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  // The room code we attached to as a read-only watcher (no session). A
  // session standing up (create/join/resume) supersedes it.
  const [watchingCode, setWatchingCode] = useState(null);
  const stateRef = useRef(null);
  // Mirrors of state the socket callbacks need without re-subscribing.
  const sessionRef = useRef(null);
  const watchingRef = useRef(null);
  // Whether this watcher is a TV display (so a reconnect re-attaches as one).
  const watchingTvRef = useRef(false);
  // A createTv() is in flight: the first snapshot tells us which room it made.
  const creatingTvRef = useRef(false);
  // The room a resume is in flight for, so a definitive failure can clear it.
  const resumeCodeRef = useRef(null);

  useEffect(() => {
    /** Forget the room entirely and fall back to the join screen. */
    const leaveRoom = (code, message) => {
      if (code) clearIdentity(code);
      sessionRef.current = null;
      watchingRef.current = null;
      watchingTvRef.current = false;
      creatingTvRef.current = false;
      resumeCodeRef.current = null;
      stateRef.current = null;
      setSession(null);
      setWatchingCode(null);
      setState(null);
      setFeed([]);
      if (message) setLastError({ code: 'REMOVED', message });
    };

    const onState = (payload) => {
      // `nextRollAt` is a server-epoch deadline. Shift it onto this device's
      // clock so a phone that is minutes fast or slow still counts down right.
      const skew = typeof payload.serverNow === 'number' ? payload.serverNow - Date.now() : 0;
      const snapshot =
        payload.nextRollAt == null ? payload : { ...payload, nextRollAt: payload.nextRollAt - skew };
      stateRef.current = snapshot;
      if (creatingTvRef.current) {
        // The TV asked for a room and doesn't know its code until now.
        creatingTvRef.current = false;
        watchingRef.current = snapshot.code;
        watchingTvRef.current = true;
        setWatchingCode(snapshot.code);
      }
      setState(snapshot);
    };
    const onSession = (payload) => {
      sessionRef.current = payload;
      resumeCodeRef.current = null;
      setSession(payload);
      setWatchingCode(null); // seated: no longer a watcher
      watchingRef.current = null;
      // The server replays the room's whole feed right after a session, so
      // start from empty or a resume would show every line twice.
      setFeed([]);
      if (payload.key === 'create' || payload.key === 'join') {
        saveIdentity(payload.code, payload.playerId, payload.token);
      }
    };
    const onFeed = (entry) => setFeed((prev) => [...prev.slice(-119), entry]);
    const onError = (err) => {
      creatingTvRef.current = false;
      if (resumeCodeRef.current && FATAL_RESUME_ERRORS.has(err.code)) {
        // The seat we tried to return to is gone (room reaped, kicked, server
        // restarted). Drop the stale identity instead of looping on it.
        const code = resumeCodeRef.current;
        leaveRoom(code);
      }
      setLastError(err);
    };
    const onConnect = () => {
      setConnected(true);
      // A reconnect lands on a fresh server-side socket that is in no room:
      // without this the board freezes and every action fails NOT_IN_GAME.
      const seat = sessionRef.current;
      if (seat) {
        resumeCodeRef.current = seat.code;
        socket.emit(C2S.RESUME, { code: seat.code, playerId: seat.playerId, token: seat.token });
      } else if (watchingRef.current && stateRef.current) {
        setFeed([]);
        socket.emit(C2S.WATCH_GAME, { code: watchingRef.current, tv: watchingTvRef.current });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onRemoved = (payload) => {
      // Kicked or the room closed: drop the local session so the next visit is clean.
      const code = (payload && payload.code) || (stateRef.current && stateRef.current.code);
      const reason = payload && payload.reason;
      leaveRoom(code, REMOVED_MESSAGES[reason] || REMOVED_MESSAGES.default);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state', onState);
    socket.on('session', onSession);
    socket.on('feed', onFeed);
    socket.on('error:info', onError);
    socket.on('removed', onRemoved);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state', onState);
      socket.off('session', onSession);
      socket.off('feed', onFeed);
      socket.off('error:info', onError);
      socket.off('removed', onRemoved);
    };
  }, []);

  /** Open the shared socket once. Safe to call repeatedly. */
  const connect = useCallback(() => {
    if (!socket.connected) socket.connect();
  }, []);

  /* ------ derived values from the single snapshot ------ */

  const myId = session ? session.playerId : null;
  const me = state ? (state.players || []).find((p) => p.id === myId) || null : null;
  const isHost = Boolean(me && me.host);
  /** True while attached to a room as a read-only spectator (no session). A
   *  STATE snapshot with the watched code bumps this on. */
  const watching = Boolean(watchingCode) && Boolean(state);
  const canBank =
    Boolean(state && me && myId && state.phase === 'playing' && me.inRound && state.pot > 0) &&
    Boolean(socket.connected) &&
    !isBankingLocked(state.rules, state.rollNumber);

  /* ------ actions ------ */

  const create = useCallback((name) => socket.emit(C2S.CREATE_GAME, { name }), []);
  const join = useCallback((name, code) => socket.emit(C2S.JOIN_GAME, { name, code }), []);
  const resume = useCallback((code, playerId, token) => {
    resumeCodeRef.current = code;
    socket.emit(C2S.RESUME, { code, playerId, token });
  }, []);
  /** Attach read-only: no name, no session, no seat — just the broadcast. */
  const watch = useCallback((code, { tv = false } = {}) => {
    watchingRef.current = code;
    watchingTvRef.current = tv;
    setWatchingCode(code);
    setLastError(null);
    setFeed([]); // the server replays recent history on arrival
    socket.emit(C2S.WATCH_GAME, { code, tv });
  }, []);
  /** Start a brand-new room from a TV: no name, no seat. The first phone to
   *  join the code becomes the host. */
  const createTv = useCallback(() => {
    creatingTvRef.current = true;
    setLastError(null);
    setFeed([]);
    socket.emit(C2S.CREATE_TV);
  }, []);

  // Actions are dropped while offline rather than buffered: socket.io would
  // otherwise replay a stale BANK or host command the moment it reconnects —
  // before the seat is even resumed.
  const bank = useCallback(() => {
    if (socket.connected) socket.emit(C2S.BANK);
  }, []);

  // Host commands — each is re-authorized server-side regardless of the local
  // isHost flag, so a stale client can never exceed its authority.
  const host = useCallback(
    (event, payload) => {
      if (socket.connected) socket.emit(event, { playerId: myId, ...payload });
    },
    [myId],
  );

  const dismissError = useCallback(() => setLastError(null), []);

  return {
    state,
    session,
    feed,
    lastError,
    connected,
    myId,
    me,
    isHost,
    watching,
    canBank,
    connect,
    dismissError,
    create,
    join,
    resume,
    watch,
    createTv,
    bank,
    host,
  };
}
