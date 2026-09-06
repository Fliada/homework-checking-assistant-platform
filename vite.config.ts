import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'frontend',
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
  port: 5173,
  strictPort: true,
  allowedHosts: [
    '.run.pinggy-free.link',
    '.free.pinggy.net',
  ],
  proxy: {
    '/api': 'http://127.0.0.1:8000',
  },
},
  preview: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}'], clearMocks: true },
});
