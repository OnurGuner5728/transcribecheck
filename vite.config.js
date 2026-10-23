import { defineConfig } from 'vite';
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/transcribecheck/' : '/',
  build: { target: 'es2022', sourcemap: false }
});