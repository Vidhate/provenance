/**
 * Event recorder for capturing the writing process.
 *
 * Captures keystrokes, deletions, paste events, and timing information
 * to create a verifiable record of human writing behavior.
 */

import { computeEventHash } from './hasher.js';

/**
 * Event types that can be recorded
 */
export const EventType = {
  INSERT: 'insert',
  DELETE: 'delete',
  PASTE: 'paste',
  SESSION_START: 'session_start',
  SESSION_END: 'session_end'
};

/**
 * Creates a new recorder instance for capturing writing events
 */
export function createRecorder() {
  let events = [];
  let lastHash = '';
  let isRecording = false;
  let sessionStartTime = null;

  return {
    /**
     * Start a new recording session
     */
    async startSession() {
      isRecording = true;
      sessionStartTime = Date.now();

      const event = {
        type: EventType.SESSION_START,
        timestamp: sessionStartTime,
        position: null,
        content: null
      };

      event.hash = await computeEventHash(event, lastHash);
      lastHash = event.hash;
      events.push(event);

      return sessionStartTime;
    },

    /**
     * End the current recording session
     */
    async endSession() {
      if (!isRecording) return null;

      const endTime = Date.now();
      const event = {
        type: EventType.SESSION_END,
        timestamp: endTime,
        position: null,
        content: null
      };

      event.hash = await computeEventHash(event, lastHash);
      lastHash = event.hash;
      events.push(event);

      isRecording = false;
      return endTime;
    },

    /**
     * Record an insert event (typing)
     * @param {number} position - Cursor position where insert occurred
     * @param {string} content - The content that was inserted
     */
    async recordInsert(position, content) {
      if (!isRecording) return null;

      const event = {
        type: EventType.INSERT,
        timestamp: Date.now(),
        position,
        content
      };

      event.hash = await computeEventHash(event, lastHash);
      lastHash = event.hash;
      events.push(event);

      return event;
    },

    /**
     * Record a delete event
     * @param {number} position - Cursor position where delete occurred
     * @param {string} content - The content that was deleted
     */
    async recordDelete(position, content) {
      if (!isRecording) return null;

      const event = {
        type: EventType.DELETE,
        timestamp: Date.now(),
        position,
        content
      };

      event.hash = await computeEventHash(event, lastHash);
      lastHash = event.hash;
      events.push(event);

      return event;
    },

    /**
     * Record a paste event
     * @param {number} position - Cursor position where paste occurred
     * @param {string} content - The content that was pasted
     */
    async recordPaste(position, content) {
      if (!isRecording) return null;

      const event = {
        type: EventType.PASTE,
        timestamp: Date.now(),
        position,
        content
      };

      event.hash = await computeEventHash(event, lastHash);
      lastHash = event.hash;
      events.push(event);

      return event;
    },

    /**
     * Get all recorded events
     */
    getEvents() {
      return [...events];
    },

    /**
     * Get recording status
     */
    isActive() {
      return isRecording;
    },

    /**
     * Get session start time
     */
    getSessionStartTime() {
      return sessionStartTime;
    },

    /**
     * Load existing events (for resuming a session)
     * @param {Array} existingEvents - Events from a previous session
     */
    loadEvents(existingEvents) {
      events = [...existingEvents];
      if (events.length > 0) {
        lastHash = events[events.length - 1].hash;
      }
    },

    /**
     * Clear all events (use with caution)
     */
    clear() {
      events = [];
      lastHash = '';
      isRecording = false;
      sessionStartTime = null;
    }
  };
}
