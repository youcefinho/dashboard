import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    include: ['src/worker/__tests__/**/*.test.ts', 'src/components/ui/__tests__/**/*.test.tsx', 'src/components/onboarding/__tests__/**/*.test.tsx', 'src/components/ecommerce/__tests__/**/*.test.tsx'],
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
