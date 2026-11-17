import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/formup-app/.
// index.html is the alarm-first app; classic.html keeps the earlier lesson-path version.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: {
    outDir: 'dist',
    target: 'es2020',
    rollupOptions: { input: { main: 'index.html', classic: 'classic.html' } },
  },
});
