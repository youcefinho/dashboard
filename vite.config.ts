import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Proxy les requêtes /api vers le worker local (wrangler dev)
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 600,
    // Sprint 35 vague 35-1A — target ES2020 : drop polyfills inutiles
    // (top-level await, optional chaining, nullish coalescing tous natifs).
    // Couverture > 96% des navigateurs en 2026.
    target: 'es2020',
    // Sprint 35 vague 35-1A — affiche la taille gzippée dans le report
    // (visibilité régression bundle size sprint après sprint).
    reportCompressedSize: true,
    // Sprint 35 vague 35-1A — split CSS par chunk (route-level CSS lazy load)
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        // Sprint 35 vague 35-1A — manualChunks raffinés.
        // Sprint 43 M1.2 — ajout vendor-cmdk, vendor-markdown, vendor-dexie,
        // vendor-signature ; isolation supplémentaire des libs lourdes pour
        // que seules les routes qui les importent les tirent.
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom')) return 'vendor-react';
          if (id.includes('node_modules/react/')) return 'vendor-react';
          if (id.includes('node_modules/@tanstack')) return 'vendor-router';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3-')) return 'vendor-recharts';
          if (id.includes('node_modules/lucide-react')) return 'vendor-lucide';
          if (id.includes('node_modules/@dnd-kit')) return 'vendor-dnd';
          if (id.includes('node_modules/@radix-ui')) return 'vendor-radix';
          if (id.includes('node_modules/@xyflow')) return 'vendor-xyflow';
          // Sprint 43 M1.2 — Splits supplémentaires
          if (id.includes('node_modules/cmdk')) return 'vendor-cmdk';
          if (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark-') || id.includes('node_modules/rehype-') || id.includes('node_modules/micromark') || id.includes('node_modules/mdast-')) return 'vendor-markdown';
          if (id.includes('node_modules/dexie')) return 'vendor-dexie';
          if (id.includes('node_modules/react-signature-canvas') || id.includes('node_modules/signature_pad')) return 'vendor-signature';
          if (id.includes('node_modules/sonner')) return 'vendor-toast';
          if (id.includes('node_modules/zod')) return 'vendor-zod';
        },
      },
    },
  },
});
