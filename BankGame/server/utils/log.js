/**
 * Minimal structured logger.
 *
 * Emits one line per event as JSON with a timestamp and an optional room-code
 * field, so logs can be filtered/grouped per game. Kept dependency-free.
 */

function emit(level, fields = {}) {
  const line = {
    t: new Date().toISOString(),
    level,
    ...fields,
  };
  (level === 'error' ? console.error : console.log)(JSON.stringify(line));
}

export const logger = {
  info(fields) {
    emit('info', fields);
  },
  warn(fields) {
    emit('warn', fields);
  },
  error(fields) {
    emit('error', fields);
  },
};
