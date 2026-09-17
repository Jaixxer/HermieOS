import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Electron loads dist via file:// — relative paths required
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  build: {
    /**
     * Vendor splitting. Routes are already lazy (`App.tsx`), so the remaining
     * bulk is shared libraries; pinning them into their own chunks means a
     * phone downloads them once and keeps them across app deploys instead of
     * re-fetching one giant bundle every time.
     */
    rollupOptions: {
      output: {
        // Two buckets only: the framework/UI stack that every screen needs,
        // and gsap (pulled in by the mission screen alone). Splitting the stack
        // finer looked tidy in the build log but measurably delayed first paint
        // on a throttled phone — each extra chunk is another round-trip on the
        // critical path — so this deliberately stays coarse.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('gsap')) return 'vendor-gsap';
          // Markdown + syntax highlighting are only pulled in by the two chat
          // screens. Left in the shared vendor chunk they were downloaded by
          // every page (including the phone's dashboard) for nothing, so they
          // get their own chunk that only chat routes resolve.
          if (/react-markdown|remark-|rehype-|micromark|mdast|hast-util|unified|vfile|highlight\.js|lowlight/.test(id)) {
            return 'vendor-markdown';
          }
          return 'vendor';
        },
      },
    },
  },
  // Tauri expects a stable env prefix, not the full VITE_ set
  envPrefix: ['VITE_', 'TAURI_'],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    exclude: ['node_modules', 'dist', 'e2e/**'],
  },
});
