/**
 * Editor Recorder - Captures writing events from the editor
 *
 * Listens to editor events and records them with the core recorder,
 * building a verifiable chain of the writing process.
 */

import { createRecorder, EventType } from '../../core/recorder.js';
import { getEditorContent } from './editor.js';

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

  // Update lastContent synchronously before any await to prevent stale reads
  // when multiple events fire in rapid succession (e.g. autocorrect + keystroke).
  lastContent = value;

  if (inputType === 'deleteContentBackward' || inputType === 'deleteContentForward') {
    // editor.js passes the exact deleted text as `data`
    if (data) {
      await recorder.recordDelete(selectionStart, data);
    }
  } else if (inputType !== 'insertFromPaste') {
    // editor.js passes the exact inserted text as `data`
    if (data) {
      const insertPosition = selectionStart - data.length;
      await recorder.recordInsert(insertPosition, data);
    }
  }
}

/**
 * Handle paste events
 */
async function handleEditorPaste(event) {
  if (!recorder || !recorder.isActive()) return;

  const { content, position } = event.detail;

  await recorder.recordPaste(position, content);

  // Update lastContent after paste is processed
  // Small delay to ensure the paste has been applied to the editor
  setTimeout(() => {
    lastContent = getEditorContent();
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
