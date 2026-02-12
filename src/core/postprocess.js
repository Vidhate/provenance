/**
 * Post-processing pipeline for provenance documents.
 *
 * Runs a set of pluggable analyzers on a loaded .provenance document
 * to produce derived statistics. Designed for extensibility: register
 * additional analyzers for typing speed, pause patterns, etc.
 *
 * Usage:
 *   import { runPostProcessing } from './postprocess.js';
 *   const results = runPostProcessing(doc);
 *   // results.pasteRatio => { pasteRatio, importedCharCount, composedCharCount, totalCharCount }
 *
 * Adding a new analyzer:
 *   import { registerAnalyzer } from './postprocess.js';
 *   registerAnalyzer('myAnalyzer', (document) => ({ ... }));
 */

// ---------------------------------------------------------------------------
// Analyzer registry
// ---------------------------------------------------------------------------

/** @type {Array<{ name: string, fn: function }>} */
const analyzers = [];

/**
 * Register an analyzer function.
 * @param {string} name  - Unique key for the analyzer (used in results object)
 * @param {function} fn  - (document) => Object  — receives a parsed .provenance
 *                         document and returns an object of computed results
 */
export function registerAnalyzer(name, fn) {
  analyzers.push({ name, fn });
}

/**
 * Remove all registered analyzers. Useful for test isolation.
 */
export function clearAnalyzers() {
  analyzers.length = 0;
}

/**
 * Run every registered analyzer against a provenance document.
 * Each analyzer is error-isolated — a failure in one does not block others.
 *
 * @param {Object} document - A parsed .provenance document
 * @returns {Object} Results keyed by analyzer name
 */
export function runPostProcessing(document) {
  const results = {};

  for (const { name, fn } of analyzers) {
    try {
      results[name] = fn(document);
    } catch (err) {
      console.error(`Analyzer "${name}" failed:`, err);
      results[name] = { error: err.message };
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Built-in analyzer: character-level paste ratio (composed vs imported)
// ---------------------------------------------------------------------------

/**
 * Compute what fraction of the final document's characters were imported
 * from external sources vs composed within the editor.
 *
 * Terminology:
 *   - 'composed' — content authored within this document (typed, or
 *     cut/copy+pasted from within the same document)
 *   - 'imported' — content pasted from an external source
 *
 * Algorithm:
 *   Replay every event in session order while maintaining:
 *   - `origins[]`        — parallel array, one entry per char: 'composed' | 'imported'
 *   - `content`          — reconstructed document string (for .includes() checks)
 *   - `deletedContent`   — accumulates deleted text within the session, so
 *                          delayed cut+paste is correctly detected
 *
 *   When a paste event occurs, the pasted string is checked against:
 *   1. The current document content (catches copy+paste within the doc)
 *   2. The deletedContent buffer (catches cut+paste, even if delayed)
 *   If found in either → 'composed'. Otherwise → 'imported'.
 *
 *   The deletedContent buffer resets on session_start, scoping detection
 *   to within a single writing session.
 *
 * @param {Object} document - A parsed .provenance document
 * @returns {{ pasteRatio: number, importedCharCount: number, composedCharCount: number, totalCharCount: number }}
 */
export function pasteRatioAnalyzer(document) {
  let origins = [];        // origins[i] = 'composed' | 'imported'
  let content = '';        // reconstructed document content
  let deletedContent = ''; // accumulates deleted text within session

  for (const session of document.sessions) {
    for (const event of session.events) {
      switch (event.type) {
        case 'session_start': {
          // baseContent is the result of prior sessions — treat as composed
          const baseContent = session.baseContent || '';
          origins = new Array(baseContent.length).fill('composed');
          content = baseContent;
          deletedContent = ''; // reset per session
          break;
        }

        case 'insert': {
          const text = event.content || '';
          if (text.length > 0) {
            const pos = event.position;
            const markers = new Array(text.length).fill('composed');
            origins.splice(pos, 0, ...markers);
            content = content.substring(0, pos) + text + content.substring(pos);
          }
          break;
        }

        case 'paste': {
          const text = event.content || '';
          if (text.length > 0) {
            const pos = event.position;

            // Determine if this paste is internal (composed) or external (imported)
            const isInternal = content.includes(text) || deletedContent.includes(text);
            const marker = isInternal ? 'composed' : 'imported';

            const markers = new Array(text.length).fill(marker);
            origins.splice(pos, 0, ...markers);
            content = content.substring(0, pos) + text + content.substring(pos);
          }
          break;
        }

        case 'delete': {
          const text = event.content || '';
          if (text.length > 0) {
            const pos = event.position;
            // Accumulate deleted content for delayed cut+paste detection
            deletedContent += content.substring(pos, pos + text.length);
            origins.splice(pos, text.length);
            content = content.substring(0, pos) + content.substring(pos + text.length);
          }
          break;
        }

        // session_end: no content change
      }
    }
  }

  const totalCharCount = origins.length;
  const importedCharCount = origins.filter(o => o === 'imported').length;
  const composedCharCount = totalCharCount - importedCharCount;

  return {
    pasteRatio: totalCharCount > 0 ? importedCharCount / totalCharCount : 0,
    importedCharCount,
    composedCharCount,
    totalCharCount
  };
}

// ---------------------------------------------------------------------------
// Default registration
// ---------------------------------------------------------------------------

registerAnalyzer('pasteRatio', pasteRatioAnalyzer);
