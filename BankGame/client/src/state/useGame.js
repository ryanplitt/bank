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
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import socket from '../socket.js';
import { C2S } from '@bank/shared';
import { saveIdentity, clearIdentity } from '../session.js';

export function useGame() {
  const [state, setState] = useState(null);
  const [session, setSession] = useState(null);
  const [feed, setFeed] = useState([]);
  const [lastError, setLastError] = useState(null);
  const [connected, setConnected] = useState(socket.connected);
  const stateRef = useRef(null);

  useEffect(() => {
    const onState = (payload) => {
      stateRef.current = payload;
      setState(payload);
    };
    const onSession = (payload) => {
      setSession(payload);
      if (payload.key === 'create' || payload.key === 'join') {
        saveIdentity(payload.code, payload.playerId, payload.token);
      }
    };
    const onFeed = (entry) => setFeed((prev) => [...prev.slice(-119), entry]);
    const onError = (err) => setLastError(err);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onRemoved = () => {
      // Kicked or the room closed: drop the local session so the next visit is clean.
      setSession(null);
      if (stateRef.current) clearIdentity(stateRef.current.code);
      setState(null);
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
  const canBank =
    Boolean(state && me && myId && state.phase === 'playing' && me.inRound && state.pot > 0) &&
    Boolean(socket.connected);

  /* ------ actions ------ */

  const create = useCallback((name) => socket.emit(C2S.CREATE_GAME, { name }), []);
  const join = useCallback((name, code) => socket.emit(C2S.JOIN_GAME, { name, code }), []);
  const resume = useCallback((code, playerId, token) =>
    socket.emit(C2S.RESUME, { code, playerId, token }), []);

  const bank = useCallback(() => socket.emit(C2S.BANK), []);

  // Host commands — each is re-authorized server-side regardless of the local
  // isHost flag, so a stale client can never exceed its authority.
  const host = useCallback(
    (event, payload) =>
      socket.emit(event, { playerId: myId, ...payload }),
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
    canBank,
    connect,
    dismissError,
    create,
    join,
    resume,
    bank,
    host,
  };
}
