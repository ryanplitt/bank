import { afterEach, describe, it, expect } from 'vitest';
import { joinUrl, roomFromLocation, tvUrl, wantsTvDisplay } from './links.js';

function at(search) {
  globalThis.window = { location: { search, origin: 'https://bank.test' } };
}

afterEach(() => {
  delete globalThis.window;
});

describe('room links', () => {
  it('reads the room code from the URL, upper-cased', () => {
    at('?room=abc234');
    expect(roomFromLocation()).toBe('ABC234');
    at('');
    expect(roomFromLocation()).toBe('');
  });

  it('detects the tv display flag', () => {
    at('?room=ABC234&tv=1');
    expect(wantsTvDisplay()).toBe(true);
    at('?tv');
    expect(wantsTvDisplay()).toBe(true);
    at('?room=ABC234&tv=0');
    expect(wantsTvDisplay()).toBe(false);
    at('?room=ABC234');
    expect(wantsTvDisplay()).toBe(false);
  });

  it('builds join and tv links that round-trip', () => {
    at('');
    expect(joinUrl('ABC234')).toBe('https://bank.test/?room=ABC234');
    expect(tvUrl('ABC234')).toBe('https://bank.test/?room=ABC234&tv=1');
    at('?room=ABC234&tv=1');
    expect(roomFromLocation()).toBe('ABC234');
    expect(wantsTvDisplay()).toBe(true);
  });
});
