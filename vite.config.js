import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2019',
    rollupOptions: {
      input: {
        // landing public la /
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        // aplicația la /dashboard
        dashboard: fileURLToPath(new URL('./dashboard.html', import.meta.url)),
      },
    },
  },
});
