/**
 * Editor Recorder - Captures writing events from the editor
 *
 * Listens to editor events and records them with the core recorder,
 * building a verifiable chain of the writing process.
 */

import { createRecorder, EventType } from '../../core/recorder.js';

let recorder = null;
let lastContent = '';
let isInitialized = false;

/**
 * Create and initialize the recorder instance
 */
export function createRecorderInstance() {
  recorder = createRecorder();

  // Listen to editor events
  document.addEventListener('editor-input', handleEditorInput);
  document.addEventListener('editor-paste', handleEditorPaste);

  isInitialized = true;

  return {
    startSession: () => recorder.startSession(),
    endSession: () => recorder.endSession(),
    getEvents: () => recorder.getEvents(),
    reset: () => {
      recorder.clear();
      lastContent = '';
    },
    /**
     * Set the base content for proper change detection
     * Call this when starting a new session with existing content
     * @param {string} content - The current editor content
     */
    setBaseContent: (content) => {
      lastContent = content;
    }
  };
}

/**
 * Handle editor input events
 * Detects inserts and deletes by comparing content
 */
async function handleEditorInput(event) {
  if (!recorder || !recorder.isActive()) return;

  const { inputType, data, value, selectionStart } = event.detail;

  // Determine what changed
  const oldContent = lastContent;
  const newContent = value;

  if (newContent.length > oldContent.length) {
    // Content was added (insert)
    const insertedLength = newContent.length - oldContent.length;
    const insertPosition = selectionStart - insertedLength;
    const insertedContent = newContent.substring(insertPosition, selectionStart);

    // Don't record paste events here - they're handled separately
    if (inputType !== 'insertFromPaste') {
      await recorder.recordInsert(insertPosition, insertedContent);
    }
  } else if (newContent.length < oldContent.length) {
    // Content was removed (delete)
    const deletedLength = oldContent.length - newContent.length;
    const deletePosition = selectionStart;

    // Find what was deleted
    const deletedContent = findDeletedContent(oldContent, newContent, deletePosition, deletedLength);

    await recorder.recordDelete(deletePosition, deletedContent);
  }

  lastContent = newContent;
}

/**
 * Find what content was deleted
 */
function findDeletedContent(oldContent, newContent, position, length) {
  // Try to find the deleted portion by comparing strings
  // This is a simplified approach - in production we might want more sophisticated diffing

  // Check if deletion was at cursor position (backspace/delete key)
  const beforeCursor = oldContent.substring(0, position);
  const afterCursor = oldContent.substring(position + length);

  // Verify our assumption
  if (beforeCursor + afterCursor === newContent) {
    return oldContent.substring(position, position + length);
  }

  // Fallback: just note the length
  return `[${length} chars]`;
}

/**
 * Handle paste events
 */
async function handleEditorPaste(event) {
  if (!recorder || !recorder.isActive()) return;

  const { content, position } = event.detail;

  await recorder.recordPaste(position, content);

  // Update lastContent after paste is processed
  // Small delay to ensure the paste has been applied to the textarea
  setTimeout(() => {
    const textarea = document.querySelector('.editor-textarea');
    if (textarea) {
      lastContent = textarea.value;
    }
  }, 10);
}

/**
 * Get all recorded events
 */
export function getRecordedEvents() {
  if (!recorder) return [];
  return recorder.getEvents();
}

/**
 * Load existing events (for resuming editing of a document)
 */
export function loadExistingEvents(events) {
  if (recorder) {
    recorder.loadEvents(events);
  }
}

/**
 * Check if recording is active
 */
export function isRecording() {
  return recorder && recorder.isActive();
}
