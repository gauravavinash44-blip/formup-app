import { defineConfig } from 'vite';

// Relative base so the build works at https://<user>.github.io/formup-app/.
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', target: 'es2020' },
});
