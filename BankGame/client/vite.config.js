import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = process.env.SERVER_PORT || '3000';
const target = `http://localhost:${SERVER_PORT}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bind on all interfaces so phones on the same wifi can reach the dev
    // server — this is a game you test with several devices at once.
    host: true,
    // Proxy the socket and API to the game server so the browser only ever
    // talks to one origin. In production the server serves the built client
    // from that same origin, so no CORS configuration is needed in either.
    proxy: {
      '/socket.io': { target, ws: true, changeOrigin: true },
      '/healthz': { target, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
