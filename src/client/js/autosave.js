/**
 * Autosave module - Debounced automatic saving
 *
 * Manages automatic saving of documents with debouncing
 * to prevent excessive writes while ensuring data is saved.
 */

// Configuration
const CONFIG = {
  DEBOUNCE_DELAY: 3000,      // 3 seconds after last keystroke
  MAX_WAIT_TIME: 30000,      // Force save after 30 seconds of continuous typing
  RETRY_DELAY: 5000,         // Retry delay on failure
  MAX_RETRIES: 3             // Maximum retry attempts
};

// State
let debounceTimer = null;
let maxWaitTimer = null;
let isDirtyFlag = false;
let retryCount = 0;
let isAutoSaving = false;
let saveCallback = null;
let lastSavedContent = '';

// DOM element for indicator
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
 * Schedule an autosave (call this on content change)
 * @param {string} currentContent - Current editor content
 * @param {boolean} hasFileHandle - Whether there's an active file handle
 */
export function scheduleAutosave(currentContent, hasFileHandle) {
  // Skip if no file handle (new unsaved document)
  if (!hasFileHandle) {
    return;
  }

  // Check if content actually changed
  if (currentContent === lastSavedContent) {
    return;
  }

  // Mark as dirty
  markDirty();

  // Clear existing debounce timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Start max wait timer if not already running
  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(async () => {
      await performAutosave(currentContent);
      maxWaitTimer = null;
    }, CONFIG.MAX_WAIT_TIME);
  }

  // Set debounce timer
  debounceTimer = setTimeout(async () => {
    await performAutosave(currentContent);

    // Clear max wait timer after successful save
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  }, CONFIG.DEBOUNCE_DELAY);
}

/**
 * Perform the autosave operation
 * @param {string} content - Content to save
 */
async function performAutosave(content) {
  if (isAutoSaving || !saveCallback) return;

  // Check if content actually changed
  if (content === lastSavedContent) {
    markClean();
    return;
  }

  isAutoSaving = true;
  updateIndicator('saving');

  try {
    await saveCallback(content);

    // Update state on success
    lastSavedContent = content;
    retryCount = 0;
    markClean();
    updateIndicator('saved');

    // Hide "saved" indicator after a delay
    setTimeout(() => {
      if (!isDirtyFlag) {
        updateIndicator('hidden');
      }
    }, 2000);

  } catch (error) {
    console.error('Autosave failed:', error);
    updateIndicator('error', error.message);

    // Retry logic
    if (retryCount < CONFIG.MAX_RETRIES) {
      retryCount++;
      setTimeout(() => performAutosave(content), CONFIG.RETRY_DELAY);
    }
  } finally {
    isAutoSaving = false;
  }
}

/**
 * Cancel pending autosave
 */
export function cancelAutosave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }
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
  isDirtyFlag = false;
  retryCount = 0;
  isAutoSaving = false;
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
 * Force an immediate save (bypass debounce)
 * @param {string} content - Content to save
 */
export async function forceSave(content) {
  cancelAutosave();
  await performAutosave(content);
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
