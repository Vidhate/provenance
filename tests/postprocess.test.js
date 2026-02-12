/**
 * Tests for the post-processing pipeline and paste-ratio analyzer.
 *
 * These are pure computation tests — no DOM or timers needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  runPostProcessing,
  registerAnalyzer,
  clearAnalyzers,
  pasteRatioAnalyzer
} from '../src/core/postprocess.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal provenance document for testing.
 * @param {Array} sessions - Array of { baseContent, events } objects
 * @returns {Object} A valid-enough document for the analyzer
 */
function buildDoc(sessions = []) {
  return {
    version: '1.0.0',
    metadata: {
      title: 'Test',
      createdAt: new Date().toISOString(),
      lastModifiedAt: new Date().toISOString(),
      editorVersion: '1.0.0'
    },
    sessions: sessions.map((s, i) => ({
      id: `session-${i + 1}`,
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      baseContent: s.baseContent || '',
      events: s.events || []
    })),
    finalContent: '',
    contentHash: ''
  };
}

/** Shorthand event factories */
function insertEv(position, content) {
  return { type: 'insert', timestamp: Date.now(), position, content, hash: '' };
}

function deleteEv(position, content) {
  return { type: 'delete', timestamp: Date.now(), position, content, hash: '' };
}

function pasteEv(position, content) {
  return { type: 'paste', timestamp: Date.now(), position, content, hash: '' };
}

function sessionStartEv() {
  return { type: 'session_start', timestamp: Date.now(), position: null, content: null, hash: '' };
}

function sessionEndEv() {
  return { type: 'session_end', timestamp: Date.now(), position: null, content: null, hash: '' };
}

// ---------------------------------------------------------------------------
// pasteRatioAnalyzer — basic origin tracking
// ---------------------------------------------------------------------------

describe('pasteRatioAnalyzer', () => {

  it('should return 0 paste ratio for empty document (no sessions)', () => {
    const doc = buildDoc([]);
    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(0);
    expect(result.importedCharCount).toBe(0);
    expect(result.composedCharCount).toBe(0);
    expect(result.totalCharCount).toBe(0);
  });

  it('should return 0 paste ratio for only typed content', () => {
    const doc = buildDoc([{
      events: [
        insertEv(0, 'H'),
        insertEv(1, 'e'),
        insertEv(2, 'l'),
        insertEv(3, 'l'),
        insertEv(4, 'o')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(0);
    expect(result.composedCharCount).toBe(5);
    expect(result.importedCharCount).toBe(0);
    expect(result.totalCharCount).toBe(5);
  });

  it('should return 1.0 paste ratio for only externally pasted content', () => {
    const doc = buildDoc([{
      events: [
        pasteEv(0, 'Hello world')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(1.0);
    expect(result.importedCharCount).toBe(11);
    expect(result.composedCharCount).toBe(0);
    expect(result.totalCharCount).toBe(11);
  });

  it('should compute correct ratio for mixed typed and external pasted content', () => {
    // Type "Hi " (3 chars), then paste "world" (5 chars) → 5/8 imported
    const doc = buildDoc([{
      events: [
        insertEv(0, 'Hi '),
        pasteEv(3, 'world')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(5 / 8);
    expect(result.importedCharCount).toBe(5);
    expect(result.composedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(8);
  });

  it('should handle delete within imported region', () => {
    // Paste "ABCDE" (5 imported), delete "BC" at position 1 → 3 imported remain
    const doc = buildDoc([{
      events: [
        pasteEv(0, 'ABCDE'),
        deleteEv(1, 'BC')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(1.0);
    expect(result.importedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle insert within imported region (splits imported chars)', () => {
    // Paste "AB" at 0, then insert "x" at position 1
    // Origins: [imported, composed, imported] → "AxB"
    const doc = buildDoc([{
      events: [
        pasteEv(0, 'AB'),
        insertEv(1, 'x')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(2 / 3);
    expect(result.importedCharCount).toBe(2);
    expect(result.composedCharCount).toBe(1);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle delete spanning composed and imported regions', () => {
    // Type "abc" at 0, paste "XY" at 3 → [composed,composed,composed,imported,imported] = "abcXY"
    // Delete 2 chars at position 2 (removes "c" composed + "X" imported) → [composed,composed,imported] = "abY"
    const doc = buildDoc([{
      events: [
        insertEv(0, 'abc'),
        pasteEv(3, 'XY'),
        deleteEv(2, 'cX')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(1 / 3);
    expect(result.importedCharCount).toBe(1);
    expect(result.composedCharCount).toBe(2);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle multi-session document with baseContent', () => {
    // Session 1: type "Hello" (5 composed)
    // Session 2: baseContent="Hello", session_start resets to 5 composed, paste " world" (6 imported)
    // Final: "Hello world" → 5 composed + 6 imported = 6/11 imported
    const doc = buildDoc([
      {
        baseContent: '',
        events: [
          insertEv(0, 'Hello')
        ]
      },
      {
        baseContent: 'Hello',
        events: [
          sessionStartEv(),
          pasteEv(5, ' world')
        ]
      }
    ]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(6 / 11);
    expect(result.importedCharCount).toBe(6);
    expect(result.composedCharCount).toBe(5);
    expect(result.totalCharCount).toBe(11);
  });

  it('should treat baseContent as composed on session_start', () => {
    // Single session with baseContent "ABC", then paste "XY" at position 3
    // Origins after session_start: [composed, composed, composed]
    // After paste: [composed, composed, composed, imported, imported]
    const doc = buildDoc([{
      baseContent: 'ABC',
      events: [
        sessionStartEv(),
        pasteEv(3, 'XY')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(2 / 5);
    expect(result.importedCharCount).toBe(2);
    expect(result.composedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(5);
  });

  it('should handle paste followed by complete deletion of imported content', () => {
    // Type "abc" (3 composed), paste "XYZ" (3 imported), delete "XYZ" (remove 3 imported)
    // Final: "abc" → 0 imported
    const doc = buildDoc([{
      events: [
        insertEv(0, 'abc'),
        pasteEv(3, 'XYZ'),
        deleteEv(3, 'XYZ')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(0);
    expect(result.importedCharCount).toBe(0);
    expect(result.composedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle events with empty or null content gracefully', () => {
    const doc = buildDoc([{
      events: [
        insertEv(0, 'abc'),
        { type: 'insert', timestamp: Date.now(), position: 3, content: '', hash: '' },
        { type: 'paste', timestamp: Date.now(), position: 3, content: null, hash: '' },
        { type: 'delete', timestamp: Date.now(), position: 0, content: '', hash: '' }
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    // Only the first insert contributes
    expect(result.pasteRatio).toBe(0);
    expect(result.composedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle session with no events', () => {
    const doc = buildDoc([{ events: [] }]);
    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(0);
    expect(result.totalCharCount).toBe(0);
  });

  it('should handle session_start followed immediately by session_end', () => {
    const doc = buildDoc([{
      baseContent: 'abc',
      events: [
        sessionStartEv(),
        sessionEndEv()
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(0);
    expect(result.composedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle multiple external pastes at different positions', () => {
    // Type "abc" (3 composed), paste "XY" at 1 → "aXYbc", paste "12" at 5 → "aXYbc12"
    // Origins: [composed, imported, imported, composed, composed, imported, imported]
    // 4 imported / 7 total
    const doc = buildDoc([{
      events: [
        insertEv(0, 'abc'),
        pasteEv(1, 'XY'),
        pasteEv(5, '12')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(4 / 7);
    expect(result.importedCharCount).toBe(4);
    expect(result.composedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// pasteRatioAnalyzer — composed vs imported classification
// ---------------------------------------------------------------------------

describe('pasteRatioAnalyzer — composed vs imported classification', () => {

  it('should classify immediate cut+paste as composed', () => {
    // Type "Hello World", delete "World" (cut), paste "World" back → composed
    const doc = buildDoc([{
      events: [
        sessionStartEv(),
        insertEv(0, 'Hello World'),
        deleteEv(6, 'World'),       // cut "World" — goes into deletedContent
        pasteEv(6, 'World')          // paste it back — found in deletedContent → composed
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.importedCharCount).toBe(0);
    expect(result.composedCharCount).toBe(11);
    expect(result.pasteRatio).toBe(0);
  });

  it('should classify delayed cut+paste as composed', () => {
    // Type "Hello World", delete "World", type more, then paste "World" back → composed
    const doc = buildDoc([{
      events: [
        sessionStartEv(),
        insertEv(0, 'Hello World'),
        deleteEv(6, 'World'),        // cut "World"
        insertEv(6, 'there'),        // type more content in between
        pasteEv(11, 'World')         // paste "World" back — still in deletedContent → composed
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.importedCharCount).toBe(0);
    expect(result.composedCharCount).toBe(16); // "Hello there" (11) + "World" (5)
    expect(result.pasteRatio).toBe(0);
  });

  it('should classify copy+paste from within doc as composed', () => {
    // Type "Hello", then paste "Hello" at end → found in current content → composed
    const doc = buildDoc([{
      events: [
        sessionStartEv(),
        insertEv(0, 'Hello'),
        pasteEv(5, 'Hello')          // "Hello" exists in current content → composed
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.importedCharCount).toBe(0);
    expect(result.composedCharCount).toBe(10);
    expect(result.pasteRatio).toBe(0);
  });

  it('should classify external paste as imported', () => {
    // Type "abc", paste "XYZ" (never in doc or deleted) → imported
    const doc = buildDoc([{
      events: [
        sessionStartEv(),
        insertEv(0, 'abc'),
        pasteEv(3, 'XYZ')            // "XYZ" not in content or deletedContent → imported
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.importedCharCount).toBe(3);
    expect(result.composedCharCount).toBe(3);
    expect(result.pasteRatio).toBeCloseTo(0.5);
  });

  it('should classify partial substring paste from doc as composed', () => {
    // Type "Hello World", paste "World" at end → "World" is substring → composed
    const doc = buildDoc([{
      events: [
        sessionStartEv(),
        insertEv(0, 'Hello World'),
        pasteEv(11, 'World')          // "World" found in current content → composed
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.importedCharCount).toBe(0);
    expect(result.composedCharCount).toBe(16);
    expect(result.pasteRatio).toBe(0);
  });

  it('should reset deletedContent on session boundary', () => {
    // Session 1: type "Hello", delete "Hello"
    // Session 2: paste "Hello" → NOT in deletedContent (reset) and NOT in content → imported
    const doc = buildDoc([
      {
        baseContent: '',
        events: [
          sessionStartEv(),
          insertEv(0, 'Hello'),
          deleteEv(0, 'Hello'),
          sessionEndEv()
        ]
      },
      {
        baseContent: '',
        events: [
          sessionStartEv(),
          pasteEv(0, 'Hello')         // deletedContent was reset on session_start → imported
        ]
      }
    ]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.importedCharCount).toBe(5);
    expect(result.composedCharCount).toBe(0);
    expect(result.pasteRatio).toBe(1.0);
  });

  it('should preserve imported classification across sessions', () => {
    // Session 1: type "abc", paste "XYZ" (imported)
    // Session 2: baseContent = "abcXYZ", paste "XYZ" again
    // The original "XYZ" from session 1 should STILL be imported,
    // and the new paste of "XYZ" will match content → composed
    // Final: "abcXYZXYZ" → abc=composed(3), XYZ=imported(3), XYZ=composed(3)
    const doc = buildDoc([
      {
        baseContent: '',
        events: [
          sessionStartEv(),
          insertEv(0, 'abc'),
          pasteEv(3, 'XYZ'),           // not in content or deletedContent → imported
          sessionEndEv()
        ]
      },
      {
        baseContent: 'abcXYZ',
        events: [
          sessionStartEv(),
          pasteEv(6, 'XYZ')            // "XYZ" found in content (baseContent) → composed
        ]
      }
    ]);

    const result = pasteRatioAnalyzer(doc);

    // The original "XYZ" from session 1 must stay imported (3 chars)
    expect(result.importedCharCount).toBe(3);
    // "abc" (3 composed) + "XYZ" original (3 imported) + "XYZ" re-pasted (3 composed) = 9 total
    expect(result.composedCharCount).toBe(6);
    expect(result.totalCharCount).toBe(9);
    expect(result.pasteRatio).toBeCloseTo(3 / 9);
  });

  it('should preserve imported classification when same text is pasted multiple times across sessions', () => {
    // Reproduces the exact bug: import text in session 1, paste it 4 more times in session 2
    // Session 1: type "Hello\n", paste "External content" (imported)
    // Session 2: baseContent = "Hello\nExternal content", paste "External content" 4 more times
    // The original "External content" should stay imported, re-pastes are composed (found in content)
    const pastedText = 'External content that I have pasted';
    const doc = buildDoc([
      {
        baseContent: '',
        events: [
          sessionStartEv(),
          insertEv(0, 'Hello\n'),
          pasteEv(6, pastedText),
          sessionEndEv()
        ]
      },
      {
        baseContent: 'Hello\n' + pastedText,
        events: [
          sessionStartEv(),
          insertEv(6 + pastedText.length, '\n'),
          pasteEv(6 + pastedText.length + 1, pastedText),
          insertEv(6 + pastedText.length * 2 + 1, '\n'),
          pasteEv(6 + pastedText.length * 2 + 2, pastedText),
          insertEv(6 + pastedText.length * 3 + 2, '\n'),
          pasteEv(6 + pastedText.length * 3 + 3, pastedText),
          insertEv(6 + pastedText.length * 4 + 3, '\n'),
          pasteEv(6 + pastedText.length * 4 + 4, pastedText),
          sessionEndEv()
        ]
      }
    ]);

    const result = pasteRatioAnalyzer(doc);

    // Only the FIRST paste (from session 1) is imported — the other 4 match content → composed
    expect(result.importedCharCount).toBe(pastedText.length);  // 35
    // "Hello\n" (6) + 4 newlines (4) + 4 re-pastes (4*35=140) = 150 composed
    expect(result.composedCharCount).toBe(6 + 4 + pastedText.length * 4);
    expect(result.pasteRatio).toBeCloseTo(pastedText.length / (6 + 4 + pastedText.length * 5));
  });

  it('should correctly handle mixed internal and external pastes in same session', () => {
    // Type "abc", cut "abc", paste "abc" (internal), paste "XYZ" (external)
    // Final: "abcXYZ" → abc=composed, XYZ=imported → 3/6 imported
    const doc = buildDoc([{
      events: [
        sessionStartEv(),
        insertEv(0, 'abc'),
        deleteEv(0, 'abc'),           // cut "abc" → deletedContent = "abc"
        pasteEv(0, 'abc'),            // found in deletedContent → composed
        pasteEv(3, 'XYZ')            // not in content ("abc") or deletedContent ("abc") — wait, "abc" is the content now. "XYZ" not found → imported
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.importedCharCount).toBe(3);
    expect(result.composedCharCount).toBe(3);
    expect(result.pasteRatio).toBeCloseTo(0.5);
  });
});

// ---------------------------------------------------------------------------
// runPostProcessing pipeline
// ---------------------------------------------------------------------------

describe('runPostProcessing pipeline', () => {

  it('should return results keyed by analyzer name', () => {
    const doc = buildDoc([{
      events: [insertEv(0, 'Hello')]
    }]);

    const results = runPostProcessing(doc);

    expect(results).toHaveProperty('pasteRatio');
    expect(results.pasteRatio).toHaveProperty('pasteRatio');
    expect(results.pasteRatio).toHaveProperty('importedCharCount');
    expect(results.pasteRatio).toHaveProperty('composedCharCount');
    expect(results.pasteRatio).toHaveProperty('totalCharCount');
  });

  it('should support registering custom analyzers', () => {
    const originalCount = Object.keys(runPostProcessing(buildDoc([]))).length;

    registerAnalyzer('testCustom', (doc) => ({
      custom: true,
      sessionCount: doc.sessions.length
    }));

    const doc = buildDoc([{ events: [] }, { events: [] }]);
    const results = runPostProcessing(doc);

    expect(results).toHaveProperty('testCustom');
    expect(results.testCustom.custom).toBe(true);
    expect(results.testCustom.sessionCount).toBe(2);

    // Clean up: rebuild with only default analyzers
    clearAnalyzers();
    registerAnalyzer('pasteRatio', pasteRatioAnalyzer);
  });

  it('should isolate analyzer errors without blocking others', () => {
    registerAnalyzer('failingAnalyzer', () => {
      throw new Error('Intentional failure');
    });

    const doc = buildDoc([{ events: [insertEv(0, 'test')] }]);
    const results = runPostProcessing(doc);

    // The default pasteRatio analyzer should still succeed
    expect(results.pasteRatio.composedCharCount).toBe(4);

    // The failing analyzer should have an error property
    expect(results.failingAnalyzer).toHaveProperty('error');
    expect(results.failingAnalyzer.error).toBe('Intentional failure');

    // Clean up
    clearAnalyzers();
    registerAnalyzer('pasteRatio', pasteRatioAnalyzer);
  });

  it('should return empty object when no analyzers are registered', () => {
    clearAnalyzers();

    const doc = buildDoc([{ events: [insertEv(0, 'test')] }]);
    const results = runPostProcessing(doc);

    expect(results).toEqual({});

    // Restore default
    registerAnalyzer('pasteRatio', pasteRatioAnalyzer);
  });
});
