import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    exclude: ['node_modules/**', '.output/**', '.wxt/**'],
  },
})
