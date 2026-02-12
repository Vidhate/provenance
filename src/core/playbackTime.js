/**
 * Playback time utilities for the viewer.
 *
 * Computes cumulative writing time for each event, collapsing inter-session
 * gaps so the progress timer reflects actual writing duration rather than
 * wall-clock span across days/weeks.
 *
 * The key insight: within a session, time between events is real writing time.
 * Between sessions (inter-session gaps) time should be collapsed to zero so
 * the progress bar reflects only active writing.
 */

/**
 * Build an array of cumulative writing-time values (in ms) for a flat,
 * timestamp-sorted event list.
 *
 * For events within the same session, the delta between consecutive
 * timestamps is added to the running total.  When the session changes
 * (i.e. an inter-session gap), no time is added — the gap is collapsed.
 *
 * @param {Array} flatEvents - Sorted events, each with `timestamp` and `sessionId`
 * @returns {{ cumulativeTimes: number[], totalTime: number }}
 *   cumulativeTimes[i] = cumulative writing ms at event i
 *   totalTime = cumulative writing ms at the last event
 */
export function buildCumulativeWritingTimes(flatEvents) {
  if (flatEvents.length === 0) {
    return { cumulativeTimes: [], totalTime: 0 };
  }

  const cumulativeTimes = new Array(flatEvents.length);
  cumulativeTimes[0] = 0;

  for (let i = 1; i < flatEvents.length; i++) {
    const prev = flatEvents[i - 1];
    const curr = flatEvents[i];

    // Only accumulate time within the same session
    if (curr.sessionId === prev.sessionId) {
      const delta = curr.timestamp - prev.timestamp;
      cumulativeTimes[i] = cumulativeTimes[i - 1] + delta;
    } else {
      // Inter-session gap — collapse to zero additional time
      cumulativeTimes[i] = cumulativeTimes[i - 1];
    }
  }

  const totalTime = cumulativeTimes[cumulativeTimes.length - 1];
  return { cumulativeTimes, totalTime };
}
