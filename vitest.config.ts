import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['src/worker/__tests__/**/*.test.ts', 'src/lib/__tests__/**/*.test.ts', 'src/components/ui/__tests__/**/*.test.tsx', 'src/components/onboarding/__tests__/**/*.test.tsx', 'src/components/ecommerce/__tests__/**/*.test.tsx', 'src/components/calls/**/*.test.tsx', 'src/components/snapshots/**/*.test.tsx', 'src/components/settings/**/*.test.tsx', 'src/components/pos/**/*.test.tsx', 'src/components/loyalty/**/*.test.tsx', 'src/components/giftcards/**/*.test.tsx', 'src/components/storefront/**/*.test.tsx', 'src/pages/**/*.test.tsx'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
