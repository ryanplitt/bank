/**
 * Room links. One place that builds and reads the URLs the app hands around:
 *
 *   /?room=CODE            join (or watch) a room
 *   /?room=CODE&tv=1       TV display: a read-only dashboard, never a player
 */

const ROOM_RE = /[?&]room=([A-Za-z0-9]{4,8})/;
const TV_RE = /[?&]tv(=1|=true)?(&|$)/;

/** The room code in the current URL, upper-cased, or ''. */
export function roomFromLocation() {
  if (typeof window === 'undefined') return '';
  const m = ROOM_RE.exec(window.location.search || '');
  return m ? m[1].toUpperCase() : '';
}

/** True when the current URL asks for the TV display (`?tv=1`). */
export function wantsTvDisplay() {
  if (typeof window === 'undefined') return false;
  return TV_RE.test(window.location.search || '');
}

function origin() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** The link a phone opens to join a room. */
export function joinUrl(code) {
  return `${origin()}/?room=${code}`;
}

/** The link a TV / laptop opens to show the room as a dashboard. */
export function tvUrl(code) {
  return `${origin()}/?room=${code}&tv=1`;
}

/** Make a refresh of this tab come back as the TV display for `code`. */
export function rememberTvDisplay(code) {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;
  window.history.replaceState(null, '', `/?room=${code}&tv=1`);
}
