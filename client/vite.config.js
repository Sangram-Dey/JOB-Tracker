import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // In dev, React runs on :5173 and the API on :4000. The proxy forwards /api calls,
  // so the browser sees one origin (cookies work, no CORS), just like in production.
  server: { proxy: { '/api': 'http://localhost:4000' } },
});
