import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const frontendHost = process.env.VITE_FRONTEND_HOST ?? process.env.FRONTEND_HOST;
const frontendPort = Number(process.env.VITE_FRONTEND_PORT ?? process.env.FRONTEND_PORT);

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
  },
  server: {
    ...(frontendHost ? { host: frontendHost } : {}),
    ...(Number.isFinite(frontendPort) && frontendPort > 0 ? { port: frontendPort } : {}),
  },
});
