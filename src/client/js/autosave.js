/**
 * Autosave module - Interval-based automatic saving
 *
 * Manages automatic saving of documents using a periodic interval
 * approach (similar to Obsidian) to ensure data is saved frequently
 * without excessive writes. Saves every 2 seconds while changes exist.
 */

// Configuration
const CONFIG = {
  SAVE_INTERVAL: 2000,       // Save every 2 seconds while dirty
  RETRY_DELAY: 5000,         // Retry delay on failure
  MAX_RETRIES: 3             // Maximum retry attempts
};

// State
let intervalTimer = null;
let isDirtyFlag = false;
let retryCount = 0;
let isAutoSaving = false;
let saveCallback = null;
let lastSavedContent = '';
let pendingContent = null;   // Content waiting to be saved
let savePromise = null;      // Track in-flight save operation

// DOM element for indicator (removed from UI - autosave is now seamless)
// Keeping the variable and functions for potential future debugging use
let autosaveIndicator = null;

/**
 * Initialize the autosave system
 * @param {Object} options
 * @param {Function} options.onSave - Callback to perform the actual save
 * @param {string} options.initialContent - Initial content (considered "saved")
 */
export function initAutosave(options = {}) {
  saveCallback = options.onSave;
  lastSavedContent = options.initialContent || '';
  autosaveIndicator = document.getElementById('autosave-indicator');

  console.log('Autosave initialized');
}

/**
 * Update the save callback (when switching files)
 * @param {Function} callback
 */
export function setSaveCallback(callback) {
  saveCallback = callback;
}

/**
 * Start the autosave interval timer
 * Called once when autosave is initialized or after reset
 */
function startAutosaveInterval() {
  if (intervalTimer) return; // Already running

  intervalTimer = setInterval(async () => {
    // Only save if dirty and we have pending content
    if (isDirtyFlag && pendingContent !== null && pendingContent !== lastSavedContent) {
      await performAutosave(pendingContent);
    }
  }, CONFIG.SAVE_INTERVAL);
}

/**
 * Stop the autosave interval timer
 */
function stopAutosaveInterval() {
  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }
}

/**
 * Schedule an autosave (call this on content change)
 * @param {string} currentContent - Current editor content
 * @param {boolean} hasFileHandle - Whether there's an active file handle
 */
export function scheduleAutosave(currentContent, hasFileHandle) {
  // Skip if no file handle (new unsaved document)
  if (!hasFileHandle) {
    return;
  }

  // Check if content actually changed from last saved
  if (currentContent === lastSavedContent) {
    return;
  }

  // Store the pending content for the next interval tick
  pendingContent = currentContent;

  // Mark as dirty
  markDirty();

  // Ensure interval is running
  startAutosaveInterval();
}

/**
 * Perform the autosave operation
 * @param {string} content - Content to save
 * @returns {Promise<boolean>} - Whether save was successful
 */
async function performAutosave(content) {
  if (isAutoSaving || !saveCallback) return false;

  // Check if content actually changed
  if (content === lastSavedContent) {
    markClean();
    return true;
  }

  isAutoSaving = true;
  updateIndicator('saving');

  // Create a promise that external code can await
  let resolvePromise;
  savePromise = new Promise(resolve => {
    resolvePromise = resolve;
  });

  try {
    await saveCallback(content);

    // Update state on success
    lastSavedContent = content;
    // Only clear pendingContent if it's the same as what we just saved
    // New content may have been scheduled during the save
    if (pendingContent === content) {
      pendingContent = null;
      markClean();
    }
    retryCount = 0;
    updateIndicator('saved');

    // Hide "saved" indicator after a delay
    setTimeout(() => {
      if (!isDirtyFlag) {
        updateIndicator('hidden');
      }
    }, 2000);

    resolvePromise(true);
    return true;

  } catch (error) {
    console.error('Autosave failed:', error);
    updateIndicator('error', error.message);

    // Retry logic
    if (retryCount < CONFIG.MAX_RETRIES) {
      retryCount++;
      setTimeout(() => performAutosave(content), CONFIG.RETRY_DELAY);
    }

    resolvePromise(false);
    return false;
  } finally {
    isAutoSaving = false;
    savePromise = null;
  }
}

/**
 * Cancel pending autosave interval
 * Note: This does NOT cancel an in-flight save - use flushAndWait for that
 */
export function cancelAutosave() {
  stopAutosaveInterval();
  pendingContent = null;
}

/**
 * Mark document as having unsaved changes
 */
export function markDirty() {
  isDirtyFlag = true;
  updateIndicator('dirty');
}

/**
 * Mark document as saved
 */
export function markClean() {
  isDirtyFlag = false;
}

/**
 * Check if document has unsaved changes
 */
export function isDirty() {
  return isDirtyFlag;
}

/**
 * Reset autosave state (for new documents or file switches)
 * @param {string} content - New base content
 */
export function resetAutosave(content = '') {
  cancelAutosave();
  lastSavedContent = content;
  pendingContent = null;
  isDirtyFlag = false;
  retryCount = 0;
  isAutoSaving = false;
  savePromise = null;
  updateIndicator('hidden');
}

/**
 * Update the autosave indicator UI
 * @param {'hidden'|'dirty'|'saving'|'saved'|'error'} state
 * @param {string} message - Optional error message
 */
function updateIndicator(state, message = '') {
  if (!autosaveIndicator) return;

  const statusSpan = autosaveIndicator.querySelector('.autosave-status');

  // Remove all state classes
  autosaveIndicator.classList.remove('hidden', 'dirty', 'saving', 'saved', 'error');

  switch (state) {
    case 'hidden':
      autosaveIndicator.classList.add('hidden');
      if (statusSpan) statusSpan.textContent = '';
      break;

    case 'dirty':
      autosaveIndicator.classList.add('dirty');
      if (statusSpan) statusSpan.textContent = 'Unsaved changes';
      break;

    case 'saving':
      autosaveIndicator.classList.add('saving');
      if (statusSpan) statusSpan.textContent = 'Saving...';
      break;

    case 'saved':
      autosaveIndicator.classList.add('saved');
      if (statusSpan) statusSpan.textContent = 'Saved';
      break;

    case 'error':
      autosaveIndicator.classList.add('error');
      if (statusSpan) statusSpan.textContent = message || 'Save failed';
      break;
  }
}

/**
 * Force an immediate save (bypass interval)
 * @param {string} content - Content to save
 * @returns {Promise<boolean>} - Whether save was successful
 */
export async function forceSave(content) {
  // Don't cancel interval, just do an immediate save
  return await performAutosave(content);
}

/**
 * Flush any pending changes and wait for completion
 * Use this before switching documents to ensure no data loss
 * @returns {Promise<boolean>} - Whether save was successful (or no save needed)
 */
export async function flushAndWait() {
  // If there's an in-flight save, wait for it
  if (savePromise) {
    await savePromise;
  }

  // If there's pending content that differs from saved, save it now
  if (pendingContent !== null && pendingContent !== lastSavedContent) {
    return await performAutosave(pendingContent);
  }

  return true;
}

/**
 * Check if there are pending saves (dirty state or in-flight save)
 * @returns {boolean}
 */
export function hasPendingSave() {
  return isDirtyFlag || isAutoSaving || savePromise !== null;
}

/**
 * Get last saved content
 */
export function getLastSavedContent() {
  return lastSavedContent;
}

/**
 * Check if autosave is currently in progress
 */
export function isSaving() {
  return isAutoSaving;
}
