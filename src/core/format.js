/**
 * Provenance file format utilities.
 *
 * Handles creation, parsing, and validation of .provenance files.
 *
 * NOTE: Currently uses JSON format for readability and debugging.
 * Future versions will migrate to a binary format for tamper resistance.
 */

import { sha256, verifyProvenanceFile } from './hasher.js';

const FORMAT_VERSION = '1.0.0';

/**
 * Create a new provenance document structure
 * @param {string} title - Document title
 * @returns {Object} - Empty provenance document
 */
export function createProvenanceDocument(title = 'Untitled') {
  return {
    version: FORMAT_VERSION,
    metadata: {
      title,
      createdAt: new Date().toISOString(),
      lastModifiedAt: new Date().toISOString(),
      editorVersion: FORMAT_VERSION
    },
    sessions: [],
    finalContent: '',
    contentHash: ''
  };
}

/**
 * Add a session to a provenance document
 * @param {Object} document - The provenance document
 * @param {string} sessionId - Unique session ID
 * @param {number} startTime - Session start timestamp
 * @param {number} endTime - Session end timestamp
 * @param {Array} events - Array of recorded events
 * @param {string} baseContent - Content at the start of this session (for multi-session documents)
 * @returns {Object} - Updated document
 */
export function addSession(document, sessionId, startTime, endTime, events, baseContent = '') {
  const session = {
    id: sessionId,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
    baseContent, // Content that existed when this session started
    events
  };

  document.sessions.push(session);
  document.metadata.lastModifiedAt = new Date().toISOString();

  return document;
}

/**
 * Finalize a provenance document with the final content
 * @param {Object} document - The provenance document
 * @param {string} finalContent - The final document content
 * @returns {Promise<Object>} - Finalized document with content hash
 */
export async function finalizeDocument(document, finalContent) {
  document.finalContent = finalContent;
  document.contentHash = await sha256(finalContent);
  document.metadata.lastModifiedAt = new Date().toISOString();

  return document;
}

/**
 * Serialize a provenance document to JSON string
 * @param {Object} document - The provenance document
 * @returns {string} - JSON string
 */
export function serialize(document) {
  return JSON.stringify(document, null, 2);
}

/**
 * Parse a provenance file from JSON string
 * @param {string} jsonString - The JSON string
 * @returns {Object} - Parsed provenance document
 */
export function parse(jsonString) {
  const document = JSON.parse(jsonString);

  // Validate basic structure
  if (!document.version || !document.metadata || !document.sessions) {
    throw new Error('Invalid provenance file format');
  }

  return document;
}

/**
 * Validate a provenance document
 * @param {Object} document - The provenance document
 * @returns {Promise<{valid: boolean, errors: Array}>}
 */
export async function validate(document) {
  const errors = [];

  // Check version
  if (!document.version) {
    errors.push('Missing version field');
  }

  // Check metadata
  if (!document.metadata) {
    errors.push('Missing metadata');
  } else {
    if (!document.metadata.createdAt) errors.push('Missing createdAt');
    if (!document.metadata.lastModifiedAt) errors.push('Missing lastModifiedAt');
  }

  // Check sessions
  if (!document.sessions || !Array.isArray(document.sessions)) {
    errors.push('Missing or invalid sessions array');
  }

  // Verify hash chains
  const hashVerification = await verifyProvenanceFile(document);
  if (!hashVerification.valid) {
    for (const result of hashVerification.results) {
      if (!result.valid) {
        errors.push(`Session ${result.sessionId}: ${result.message}`);
      }
    }
  }

  // Verify final content hash
  if (document.finalContent && document.contentHash) {
    const computedHash = await sha256(document.finalContent);
    if (computedHash !== document.contentHash) {
      errors.push('Final content hash mismatch - content may have been tampered with');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Get summary statistics from a provenance document
 * @param {Object} document - The provenance document
 * @returns {Object} - Statistics about the writing process
 */
export function getStatistics(document) {
  let totalEvents = 0;
  let insertEvents = 0;
  let deleteEvents = 0;
  let pasteEvents = 0;
  let totalCharsTyped = 0;
  let totalCharsDeleted = 0;
  let totalCharsPasted = 0;

  for (const session of document.sessions) {
    for (const event of session.events) {
      totalEvents++;

      switch (event.type) {
        case 'insert':
          insertEvents++;
          totalCharsTyped += (event.content || '').length;
          break;
        case 'delete':
          deleteEvents++;
          totalCharsDeleted += (event.content || '').length;
          break;
        case 'paste':
          pasteEvents++;
          totalCharsPasted += (event.content || '').length;
          break;
      }
    }
  }

  // Calculate time spans
  let totalWritingTimeMs = 0;
  for (const session of document.sessions) {
    if (session.startTime && session.endTime) {
      const start = new Date(session.startTime).getTime();
      const end = new Date(session.endTime).getTime();
      totalWritingTimeMs += (end - start);
    }
  }

  return {
    sessionCount: document.sessions.length,
    totalEvents,
    insertEvents,
    deleteEvents,
    pasteEvents,
    totalCharsTyped,
    totalCharsDeleted,
    totalCharsPasted,
    totalWritingTimeMs,
    totalWritingTimeFormatted: formatDuration(totalWritingTimeMs),
    pasteRatio: totalEvents > 0 ? (pasteEvents / totalEvents) : 0,
    finalContentLength: (document.finalContent || '').length
  };
}

/**
 * Format milliseconds as human-readable duration
 * @param {number} ms - Duration in milliseconds
 * @returns {string} - Formatted duration
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}
