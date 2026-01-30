/**
 * Test setup file
 *
 * This file runs before each test file and sets up the testing environment.
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Mock timers globally for controlling setInterval/setTimeout
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// Setup minimal DOM elements that autosave.js expects
beforeEach(() => {
  // Create a minimal DOM structure for tests that need it
  document.body.innerHTML = `
    <div id="autosave-indicator" class="autosave-indicator hidden">
      <span class="autosave-status"></span>
    </div>
  `;
});
