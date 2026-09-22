import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Configurable because "localhost" means something different inside a
// Docker container (the container itself, not the host) — docker-compose
// sets this to the server container's service name.
const apiProxyTarget = process.env.API_PROXY_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind 0.0.0.0 so the dev server is reachable from outside a container
    port: 5173,
    // Same-origin from the browser's perspective, so the server's
    // cookie-session cookie flows without any CORS configuration.
    proxy: {
      '/api': apiProxyTarget,
      '/auth': apiProxyTarget,
    },
  },
});
