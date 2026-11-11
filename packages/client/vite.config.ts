import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = process.env.TANDEM_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/ws': { target: server, ws: true },
    },
  },
});
