import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['BankGame/**/*.test.js'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    // Integration tests bind real sockets; give them room without letting a
    // genuine hang sit forever.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
