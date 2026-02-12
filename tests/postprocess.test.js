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
// pasteRatioAnalyzer
// ---------------------------------------------------------------------------

describe('pasteRatioAnalyzer', () => {

  it('should return 0 paste ratio for empty document (no sessions)', () => {
    const doc = buildDoc([]);
    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(0);
    expect(result.pastedCharCount).toBe(0);
    expect(result.typedCharCount).toBe(0);
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
    expect(result.typedCharCount).toBe(5);
    expect(result.pastedCharCount).toBe(0);
    expect(result.totalCharCount).toBe(5);
  });

  it('should return 1.0 paste ratio for only pasted content', () => {
    const doc = buildDoc([{
      events: [
        pasteEv(0, 'Hello world')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(1.0);
    expect(result.pastedCharCount).toBe(11);
    expect(result.typedCharCount).toBe(0);
    expect(result.totalCharCount).toBe(11);
  });

  it('should compute correct ratio for mixed typed and pasted content', () => {
    // Type "Hi " (3 chars), then paste "world" (5 chars) → 5/8 pasted
    const doc = buildDoc([{
      events: [
        insertEv(0, 'Hi '),
        pasteEv(3, 'world')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(5 / 8);
    expect(result.pastedCharCount).toBe(5);
    expect(result.typedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(8);
  });

  it('should handle delete within pasted region', () => {
    // Paste "ABCDE" (5 pasted), delete "BC" at position 1 → 3 pasted remain
    const doc = buildDoc([{
      events: [
        pasteEv(0, 'ABCDE'),
        deleteEv(1, 'BC')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(1.0);
    expect(result.pastedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle insert within pasted region (splits pasted chars)', () => {
    // Paste "AB" at 0, then insert "x" at position 1
    // Origins: [pasted, typed, pasted] → "AxB"
    const doc = buildDoc([{
      events: [
        pasteEv(0, 'AB'),
        insertEv(1, 'x')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(2 / 3);
    expect(result.pastedCharCount).toBe(2);
    expect(result.typedCharCount).toBe(1);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle delete spanning typed and pasted regions', () => {
    // Type "abc" at 0, paste "XY" at 3 → [typed,typed,typed,pasted,pasted] = "abcXY"
    // Delete 2 chars at position 2 (removes "c" typed + "X" pasted) → [typed,typed,pasted] = "abY"
    const doc = buildDoc([{
      events: [
        insertEv(0, 'abc'),
        pasteEv(3, 'XY'),
        deleteEv(2, 'cX')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(1 / 3);
    expect(result.pastedCharCount).toBe(1);
    expect(result.typedCharCount).toBe(2);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle multi-session document with baseContent', () => {
    // Session 1: type "Hello" (5 typed)
    // Session 2: baseContent="Hello", session_start resets to 5 typed, paste " world" (6 pasted)
    // Final: "Hello world" → 5 typed + 6 pasted = 6/11 pasted
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
    expect(result.pastedCharCount).toBe(6);
    expect(result.typedCharCount).toBe(5);
    expect(result.totalCharCount).toBe(11);
  });

  it('should treat baseContent as typed on session_start', () => {
    // Single session with baseContent "ABC", then paste "XY" at position 3
    // Origins after session_start: [typed, typed, typed]
    // After paste: [typed, typed, typed, pasted, pasted]
    const doc = buildDoc([{
      baseContent: 'ABC',
      events: [
        sessionStartEv(),
        pasteEv(3, 'XY')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(2 / 5);
    expect(result.pastedCharCount).toBe(2);
    expect(result.typedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(5);
  });

  it('should handle paste followed by complete deletion of pasted content', () => {
    // Type "abc" (3 typed), paste "XYZ" (3 pasted), delete "XYZ" (remove 3 pasted)
    // Final: "abc" → 0 pasted
    const doc = buildDoc([{
      events: [
        insertEv(0, 'abc'),
        pasteEv(3, 'XYZ'),
        deleteEv(3, 'XYZ')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBe(0);
    expect(result.pastedCharCount).toBe(0);
    expect(result.typedCharCount).toBe(3);
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
    expect(result.typedCharCount).toBe(3);
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
    expect(result.typedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(3);
  });

  it('should handle multiple pastes at different positions', () => {
    // Type "abc" (3 typed), paste "XY" at 1 → "aXYbc", paste "12" at 5 → "aXYbc12"
    // Origins: [typed, pasted, pasted, typed, typed, pasted, pasted]
    // 4 pasted / 7 total
    const doc = buildDoc([{
      events: [
        insertEv(0, 'abc'),
        pasteEv(1, 'XY'),
        pasteEv(5, '12')
      ]
    }]);

    const result = pasteRatioAnalyzer(doc);

    expect(result.pasteRatio).toBeCloseTo(4 / 7);
    expect(result.pastedCharCount).toBe(4);
    expect(result.typedCharCount).toBe(3);
    expect(result.totalCharCount).toBe(7);
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
    expect(results.pasteRatio).toHaveProperty('pastedCharCount');
    expect(results.pasteRatio).toHaveProperty('typedCharCount');
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
    expect(results.pasteRatio.typedCharCount).toBe(4);

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
