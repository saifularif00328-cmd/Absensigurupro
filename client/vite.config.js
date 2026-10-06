import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },   // face-api (±1,3 MB) dimuat lazy hanya di layar wajah
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
