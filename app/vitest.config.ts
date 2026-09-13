import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  define: {
    // Fixed value for tests; the real build number is the git commit count
    // injected by vite.config.ts at build time.
    __BUILD_NUMBER__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/tests/setup.ts',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/**', // Exclude Playwright E2E tests (root tests/, not src/tests/)
      'android/**', // Exclude the native Android tree (llama.cpp FetchContent source under .cxx/_deps)
      '.features-gen/**', // Exclude generated playwright-bdd specs
      '**/*.spec.ts', // Exclude Playwright test files
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Only the app source counts. Without an explicit include, v8 also
      // instruments the native Android build tree (android/app/build/**,
      // the llama.cpp sources vendored under .cxx/_deps) and the dev
      // mock server, which inflated the reported total to 83% of 1.9M
      // statements and made the thresholds below meaningless.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/tests/',
        '**/__tests__/**',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'src/lib/vendor/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
