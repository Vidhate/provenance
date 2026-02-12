/**
 * Playback time tests
 *
 * Tests for the cumulative writing-time computation that powers the
 * progress bar timer in the Verify view.  The key requirement is that
 * inter-session gaps are collapsed so the timer reflects actual writing
 * duration, not wall-clock span across days.
 */

import { describe, it, expect } from 'vitest';
import { buildCumulativeWritingTimes } from '../src/core/playbackTime.js';

describe('buildCumulativeWritingTimes', () => {
  // ── Edge cases ──────────────────────────────────────────────────────

  it('returns empty arrays for an empty event list', () => {
    const result = buildCumulativeWritingTimes([]);
    expect(result.cumulativeTimes).toEqual([]);
    expect(result.totalTime).toBe(0);
  });

  it('returns zero time for a single event', () => {
    const events = [{ timestamp: 1000, sessionId: 's1' }];
    const result = buildCumulativeWritingTimes(events);
    expect(result.cumulativeTimes).toEqual([0]);
    expect(result.totalTime).toBe(0);
  });

  // ── Single session ─────────────────────────────────────────────────

  it('accumulates time between events within a single session', () => {
    const events = [
      { timestamp: 1000, sessionId: 's1' },
      { timestamp: 1100, sessionId: 's1' },
      { timestamp: 1300, sessionId: 's1' },
      { timestamp: 1600, sessionId: 's1' },
    ];

    const result = buildCumulativeWritingTimes(events);

    expect(result.cumulativeTimes).toEqual([0, 100, 300, 600]);
    expect(result.totalTime).toBe(600);
  });

  it('handles rapid events (same timestamp) within a session', () => {
    const events = [
      { timestamp: 5000, sessionId: 's1' },
      { timestamp: 5000, sessionId: 's1' },
      { timestamp: 5000, sessionId: 's1' },
      { timestamp: 5050, sessionId: 's1' },
    ];

    const result = buildCumulativeWritingTimes(events);

    expect(result.cumulativeTimes).toEqual([0, 0, 0, 50]);
    expect(result.totalTime).toBe(50);
  });

  // ── Multi-session gap collapsing ───────────────────────────────────

  it('collapses inter-session gaps (the core bug fix)', () => {
    // Session 1: 10 seconds of writing, then a 2-day gap, then session 2: 5 seconds
    const DAY = 86_400_000;
    const events = [
      { timestamp: 1000, sessionId: 's1' },
      { timestamp: 6000, sessionId: 's1' },   // +5s
      { timestamp: 11000, sessionId: 's1' },  // +5s  → cumulative 10s
      // ── 2 day gap ──
      { timestamp: 11000 + 2 * DAY, sessionId: 's2' },       // session start
      { timestamp: 11000 + 2 * DAY + 3000, sessionId: 's2' }, // +3s
      { timestamp: 11000 + 2 * DAY + 5000, sessionId: 's2' }, // +2s → cumulative 15s
    ];

    const result = buildCumulativeWritingTimes(events);

    // Event 0: 0ms
    // Event 1: 5000ms
    // Event 2: 10000ms
    // Event 3: 10000ms  (gap collapsed — no time added)
    // Event 4: 13000ms
    // Event 5: 15000ms
    expect(result.cumulativeTimes).toEqual([0, 5000, 10000, 10000, 13000, 15000]);
    expect(result.totalTime).toBe(15000);
  });

  it('collapses gaps across many sessions', () => {
    const HOUR = 3_600_000;
    const events = [
      // Session 1: 1 second
      { timestamp: 0, sessionId: 's1' },
      { timestamp: 1000, sessionId: 's1' },
      // Gap: 1 hour
      // Session 2: 2 seconds
      { timestamp: HOUR, sessionId: 's2' },
      { timestamp: HOUR + 2000, sessionId: 's2' },
      // Gap: 3 hours
      // Session 3: 0.5 seconds
      { timestamp: 4 * HOUR, sessionId: 's3' },
      { timestamp: 4 * HOUR + 500, sessionId: 's3' },
    ];

    const result = buildCumulativeWritingTimes(events);

    expect(result.cumulativeTimes).toEqual([0, 1000, 1000, 3000, 3000, 3500]);
    expect(result.totalTime).toBe(3500); // 1s + 2s + 0.5s = 3.5s
  });

  // ── Monotonicity ───────────────────────────────────────────────────

  it('produces strictly non-decreasing cumulative times', () => {
    // A realistic multi-session document
    const events = [
      { timestamp: 100, sessionId: 's1' },
      { timestamp: 200, sessionId: 's1' },
      { timestamp: 250, sessionId: 's1' },
      // gap
      { timestamp: 90000, sessionId: 's2' },
      { timestamp: 90050, sessionId: 's2' },
      { timestamp: 90100, sessionId: 's2' },
      // gap
      { timestamp: 500000, sessionId: 's3' },
      { timestamp: 500010, sessionId: 's3' },
    ];

    const { cumulativeTimes } = buildCumulativeWritingTimes(events);

    for (let i = 1; i < cumulativeTimes.length; i++) {
      expect(cumulativeTimes[i]).toBeGreaterThanOrEqual(cumulativeTimes[i - 1]);
    }
  });

  it('total time equals sum of individual session durations', () => {
    const events = [
      // Session A: spans 500ms
      { timestamp: 0, sessionId: 'a' },
      { timestamp: 200, sessionId: 'a' },
      { timestamp: 500, sessionId: 'a' },
      // Session B: spans 300ms
      { timestamp: 100000, sessionId: 'b' },
      { timestamp: 100100, sessionId: 'b' },
      { timestamp: 100300, sessionId: 'b' },
      // Session C: spans 150ms
      { timestamp: 999000, sessionId: 'c' },
      { timestamp: 999050, sessionId: 'c' },
      { timestamp: 999150, sessionId: 'c' },
    ];

    const result = buildCumulativeWritingTimes(events);

    // Sum of intra-session spans: 500 + 300 + 150 = 950
    expect(result.totalTime).toBe(950);
  });

  // ── Progress bar smoothness ────────────────────────────────────────

  it('progress increases within each session (no jumps backwards)', () => {
    const DAY = 86_400_000;
    const events = [];

    // Build 3 sessions, each with 20 events spaced 100ms apart,
    // separated by 1-day gaps
    for (let s = 0; s < 3; s++) {
      const sessionBase = s * DAY;
      const sessionId = `session-${s}`;
      for (let e = 0; e < 20; e++) {
        events.push({ timestamp: sessionBase + e * 100, sessionId });
      }
    }

    const { cumulativeTimes, totalTime } = buildCumulativeWritingTimes(events);

    // Should be 60 events total
    expect(cumulativeTimes.length).toBe(60);

    // Total writing time = 3 sessions × 19 intervals × 100ms = 5700ms
    expect(totalTime).toBe(5700);

    // Without the fix, raw timestamp diff would be ~2 days + 1900ms ≈ 172_801_900ms
    // Verify that our total is orders of magnitude smaller than wall-clock span
    const wallClockSpan = events[events.length - 1].timestamp - events[0].timestamp;
    expect(totalTime).toBeLessThan(wallClockSpan / 10);

    // Verify monotonically non-decreasing
    for (let i = 1; i < cumulativeTimes.length; i++) {
      expect(cumulativeTimes[i]).toBeGreaterThanOrEqual(cumulativeTimes[i - 1]);
    }
  });

  it('seeking to any event index yields consistent cumulative time', () => {
    const events = [
      { timestamp: 0, sessionId: 's1' },
      { timestamp: 50, sessionId: 's1' },
      { timestamp: 150, sessionId: 's1' },
      // gap
      { timestamp: 1000000, sessionId: 's2' },
      { timestamp: 1000080, sessionId: 's2' },
      { timestamp: 1000200, sessionId: 's2' },
    ];

    const { cumulativeTimes, totalTime } = buildCumulativeWritingTimes(events);

    // Seeking to event 0 → 0ms
    expect(cumulativeTimes[0]).toBe(0);
    // Seeking to event 2 (end of session 1) → 150ms
    expect(cumulativeTimes[2]).toBe(150);
    // Seeking to event 3 (start of session 2) → still 150ms (gap collapsed)
    expect(cumulativeTimes[3]).toBe(150);
    // Seeking to last event → totalTime
    expect(cumulativeTimes[cumulativeTimes.length - 1]).toBe(totalTime);
  });

  // ── Session with only session_start/session_end (no content events) ─

  it('handles sessions with only lifecycle events (no actual typing)', () => {
    const events = [
      // Session 1: real typing
      { timestamp: 0, sessionId: 's1', type: 'session_start' },
      { timestamp: 100, sessionId: 's1', type: 'insert' },
      { timestamp: 200, sessionId: 's1', type: 'session_end' },
      // Session 2: empty session (just start/end)
      { timestamp: 50000, sessionId: 's2', type: 'session_start' },
      { timestamp: 50001, sessionId: 's2', type: 'session_end' },
      // Session 3: more typing
      { timestamp: 100000, sessionId: 's3', type: 'session_start' },
      { timestamp: 100300, sessionId: 's3', type: 'insert' },
      { timestamp: 100500, sessionId: 's3', type: 'session_end' },
    ];

    const { cumulativeTimes, totalTime } = buildCumulativeWritingTimes(events);

    // s1 duration: 200ms, s2 duration: 1ms, s3 duration: 500ms → total 701ms
    expect(totalTime).toBe(701);
    // Check that the gap between s1 end and s2 start is collapsed
    expect(cumulativeTimes[3]).toBe(cumulativeTimes[2]); // s2 start = s1 end cumulative
  });
});
