/**
 * Socket event names, shared by client and server.
 *
 * Both sides import these constants rather than typing string literals, so a
 * rename can never silently desynchronise the two halves of the protocol.
 */

/** Client -> server. */
export const C2S = {
  CREATE_GAME: 'game:create',
  JOIN_GAME: 'game:join',
  RESUME: 'game:resume',
  LEAVE_GAME: 'game:leave',

  BANK: 'play:bank',

  // Host-only commands.
  START_GAME: 'host:start',
  UPDATE_RULES: 'host:updateRules',
  KICK_PLAYER: 'host:kick',
  RENAME_PLAYER: 'host:rename',
  ADJUST_SCORE: 'host:adjustScore',
  FORCE_ROLL: 'host:forceRoll',
  FORCE_END_ROUND: 'host:forceEndRound',
  TRANSFER_HOST: 'host:transfer',
  END_GAME: 'host:endGame',
  PLAY_AGAIN: 'host:playAgain',
  SET_PAUSED: 'host:setPaused',
};

/** Server -> client. */
export const S2C = {
  /** Issued once on a successful create/join/resume: identity + room code. */
  SESSION: 'session',
  /** Full versioned state snapshot. Clients replace, never merge. */
  STATE: 'state',
  /** Append-only narration feed ("Ryan banked 340"). */
  FEED: 'feed',
  /** A request failed. `{ code, message }` */
  ERROR: 'error:info',
  /** This client was removed from the room (kicked, or the room closed). */
  REMOVED: 'removed',
};

/** Stable error codes so the client can react without string matching. */
export const ERROR_CODES = {
  NO_SUCH_GAME: 'NO_SUCH_GAME',
  GAME_FULL: 'GAME_FULL',
  GAME_IN_PROGRESS: 'GAME_IN_PROGRESS',
  NAME_TAKEN: 'NAME_TAKEN',
  INVALID_NAME: 'INVALID_NAME',
  INVALID_CODE: 'INVALID_CODE',
  INVALID_RULES: 'INVALID_RULES',
  NOT_IN_GAME: 'NOT_IN_GAME',
  NOT_HOST: 'NOT_HOST',
  BAD_PHASE: 'BAD_PHASE',
  ALREADY_BANKED: 'ALREADY_BANKED',
  NOTHING_TO_BANK: 'NOTHING_TO_BANK',
  NOT_ENOUGH_PLAYERS: 'NOT_ENOUGH_PLAYERS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER_BUSY: 'SERVER_BUSY',
  INTERNAL: 'INTERNAL',
};

/** Kinds carried on the narration feed. */
export const FEED_KIND = {
  PLAYER_JOINED: 'playerJoined',
  PLAYER_LEFT: 'playerLeft',
  PLAYER_REJOINED: 'playerRejoined',
  PLAYER_KICKED: 'playerKicked',
  PLAYER_RENAMED: 'playerRenamed',
  GAME_STARTED: 'gameStarted',
  ROUND_STARTED: 'roundStarted',
  ROLL: 'roll',
  BANKED: 'banked',
  ROUND_BUSTED: 'roundBusted',
  ROUND_ENDED: 'roundEnded',
  GAME_OVER: 'gameOver',
  HOST_CHANGED: 'hostChanged',
  SCORE_ADJUSTED: 'scoreAdjusted',
  RULES_CHANGED: 'rulesChanged',
  PAUSED: 'paused',
  RESUMED: 'resumed',
};
