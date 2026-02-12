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
 *   // results.pasteRatio => { pasteRatio, pastedCharCount, typedCharCount, totalCharCount }
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
// Built-in analyzer: character-level paste ratio
// ---------------------------------------------------------------------------

/**
 * Compute what fraction of the final document's characters originated from
 * paste events rather than manual typing.
 *
 * Algorithm:
 *   Replay every event in session order while maintaining a parallel
 *   `origins` array — one entry per character in the reconstructed content.
 *   Each entry is either 'typed' or 'pasted'.
 *
 *   - session_start : reset origins to all-'typed' for baseContent
 *                     (baseContent is prior-session output, already authored)
 *   - insert        : splice in 'typed' markers at position
 *   - paste         : splice in 'pasted' markers at position
 *   - delete        : remove markers at position
 *   - session_end   : no-op
 *
 * @param {Object} document - A parsed .provenance document
 * @returns {{ pasteRatio: number, pastedCharCount: number, typedCharCount: number, totalCharCount: number }}
 */
export function pasteRatioAnalyzer(document) {
  let origins = []; // origins[i] = 'typed' | 'pasted'

  for (const session of document.sessions) {
    for (const event of session.events) {
      switch (event.type) {
        case 'session_start': {
          // baseContent is the result of prior sessions — treat as typed
          const baseContent = session.baseContent || '';
          origins = new Array(baseContent.length).fill('typed');
          break;
        }

        case 'insert': {
          const content = event.content || '';
          if (content.length > 0) {
            const pos = event.position;
            const markers = new Array(content.length).fill('typed');
            origins.splice(pos, 0, ...markers);
          }
          break;
        }

        case 'paste': {
          const content = event.content || '';
          if (content.length > 0) {
            const pos = event.position;
            const markers = new Array(content.length).fill('pasted');
            origins.splice(pos, 0, ...markers);
          }
          break;
        }

        case 'delete': {
          const content = event.content || '';
          if (content.length > 0) {
            const pos = event.position;
            origins.splice(pos, content.length);
          }
          break;
        }

        // session_end: no content change
      }
    }
  }

  const totalCharCount = origins.length;
  const pastedCharCount = origins.filter(o => o === 'pasted').length;
  const typedCharCount = totalCharCount - pastedCharCount;

  return {
    pasteRatio: totalCharCount > 0 ? pastedCharCount / totalCharCount : 0,
    pastedCharCount,
    typedCharCount,
    totalCharCount
  };
}

// ---------------------------------------------------------------------------
// Default registration
// ---------------------------------------------------------------------------

registerAnalyzer('pasteRatio', pasteRatioAnalyzer);
