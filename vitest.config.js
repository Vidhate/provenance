import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use jsdom for DOM testing
    environment: 'jsdom',

    // Test file patterns
    include: ['tests/**/*.test.js'],

    // Setup files run before each test file
    setupFiles: ['tests/setup.js'],

    // Enable globals like describe, it, expect
    globals: true,

    // Timeout for async tests
    testTimeout: 10000,
  },
});
