/**
 * Viewer module - Replay and verify provenance files
 *
 * Provides playback of the writing process with speed controls,
 * visual indicators for different event types, and verification status.
 */

import { validate, getStatistics } from '../../core/format.js';
import { runPostProcessing } from '../../core/postprocess.js';
import { buildCumulativeWritingTimes } from '../../core/playbackTime.js';

// Playback constants
const FIXED_REPLAY_SPEED = 8;      // Divisor applied to real inter-event gaps
const MAX_INTER_EVENT_DELAY = 400; // ms — cap for normal (non-pause) delays
const MIN_DELAY = 10;              // ms — minimum delay between events
const PAUSE_THRESHOLD_MS = 10000;  // 10 s — gaps longer than this are skipped with a toast

// State
let currentDocument = null;
let allEvents = [];
let flatEvents = []; // All events flattened with absolute timestamps
let cumulativeTimes = []; // Cumulative writing time (ms) at each event index
let totalWritingTime = 0; // Total cumulative writing time (ms)
let currentEventIndex = 0;
let isPlaying = false;
let playbackTimer = null;
let replayContent = '';
let replayOrigins = []; // Parallel array: 'composed' | 'imported' per character
let replayDeletedContent = ''; // Accumulates deleted text within session for cut+paste detection
let lastChangePosition = 0; // Character offset of the most recent insert/delete/paste

// DOM Elements
let viewerEmpty, viewerContent, viewerTitle;
let verificationStatus, btnPlay, btnPause, btnReset;
let replayProgress, replayTime;
let replayEditor, eventIndicator;
let statWritingTime, statOriginalPct;
let btnToggleDetails, statsDetails, statsDetailSummary, statsDetailSessions;

/**
 * Initialize the viewer
 */
export function initViewer() {
  // Get DOM elements
  viewerEmpty = document.getElementById('viewer-empty');
  viewerContent = document.getElementById('viewer-content');
  viewerTitle = document.getElementById('viewer-title');
  verificationStatus = document.getElementById('verification-status');
  btnPlay = document.getElementById('btn-play');
  btnPause = document.getElementById('btn-pause');
  btnReset = document.getElementById('btn-reset');
  replayProgress = document.getElementById('replay-progress');
  replayTime = document.getElementById('replay-time');
  replayEditor = document.getElementById('replay-editor');
  eventIndicator = document.getElementById('event-indicator');
  statWritingTime = document.getElementById('stat-writing-time');
  statOriginalPct = document.getElementById('stat-original-pct');
  btnToggleDetails = document.getElementById('btn-toggle-details');
  statsDetails = document.getElementById('stats-details');
  statsDetailSummary = document.getElementById('stats-detail-summary');
  statsDetailSessions = document.getElementById('stats-detail-sessions');

  // Setup event listeners
  btnPlay.addEventListener('click', startPlayback);
  btnPause.addEventListener('click', pausePlayback);
  btnReset.addEventListener('click', resetPlayback);
  replayProgress.addEventListener('input', handleProgressSeek);
  btnToggleDetails.addEventListener('click', toggleDetails);
}

/**
 * Load a provenance file for viewing
 */
export async function loadProvenanceFile(doc) {
  currentDocument = doc;

  // Validate the document
  const validation = await validate(doc);

  // Update verification status
  if (validation.valid) {
    verificationStatus.textContent = 'Verified';
    verificationStatus.className = 'verification-badge verified';
  } else {
    verificationStatus.textContent = 'Invalid';
    verificationStatus.className = 'verification-badge invalid';
    console.warn('Validation errors:', validation.errors);
  }

  // Get statistics
  const stats = getStatistics(doc);

  // Run post-processing pipeline for derived statistics
  const postResults = runPostProcessing(doc);
  const pasteAnalysis = postResults.pasteRatio || {};

  // Use character-level paste ratio from post-processing, fall back to event-count ratio
  const displayPasteRatio = (pasteAnalysis.pasteRatio ?? stats.pasteRatio) * 100;
  const originalPct = (100 - displayPasteRatio).toFixed(1);

  // Update UI
  viewerTitle.textContent = doc.metadata.title || 'Untitled';

  // Primary stats bar
  statWritingTime.textContent = stats.totalWritingTimeFormatted;
  statOriginalPct.textContent = `${originalPct}%`;

  // Detail summary — individual spans with tooltips and highlighted numbers
  const importedCount = pasteAnalysis.importedCharCount ?? 0;
  const totalCount = pasteAnalysis.totalCharCount ?? stats.finalContentLength;

  const detailStats = [
    {
      value: stats.sessionCount,
      label: 'Sessions',
      tooltip: 'Number of separate writing sittings recorded for this document'
    },
    {
      value: stats.totalEvents,
      label: 'Events',
      tooltip: 'Total number of recorded actions — keystrokes, deletions, pastes, and session markers'
    },
    {
      value: stats.totalCharsTyped,
      label: 'Chars Typed',
      tooltip: 'Total characters inserted by typing (excludes pasted content)'
    },
    {
      value: stats.pasteEvents,
      label: 'Paste Events',
      tooltip: 'Number of times content was pasted from the clipboard'
    },
    {
      value: `${importedCount}/${totalCount}`,
      label: 'Imported Chars',
      tooltip: 'Characters pasted from external sources vs total characters in the final document'
    }
  ];

  statsDetailSummary.innerHTML = detailStats.map(s =>
    `<span class="detail-stat" title="${s.tooltip}"><span class="detail-stat-value">${s.value}</span> ${s.label}</span>`
  ).join('<span class="detail-stat-sep"> · </span>');

  // Collapse details by default
  statsDetails.classList.add('hidden');
  btnToggleDetails.classList.remove('expanded');

  // Build session list inside details
  buildSessionList(doc.sessions);

  // Flatten all events with absolute timestamps
  flattenEvents(doc.sessions);

  // Show content, hide empty state
  viewerEmpty.style.display = 'none';
  viewerContent.classList.remove('hidden');

  // Reset playback state
  resetPlayback();
}

/**
 * Flatten events from all sessions into a single timeline
 * Each event includes the session's baseContent for proper replay
 */
function flattenEvents(sessions) {
  flatEvents = [];

  for (const session of sessions) {
    for (const event of session.events) {
      flatEvents.push({
        ...event,
        sessionId: session.id,
        sessionBaseContent: session.baseContent || '' // Content at session start
      });
    }
  }

  // Sort by timestamp
  flatEvents.sort((a, b) => a.timestamp - b.timestamp);

  // Build cumulative writing-time map (collapses inter-session gaps)
  const timeMap = buildCumulativeWritingTimes(flatEvents);
  cumulativeTimes = timeMap.cumulativeTimes;
  totalWritingTime = timeMap.totalTime;

  // Update progress slider
  replayProgress.max = flatEvents.length - 1;
}

/**
 * Toggle the details card
 */
function toggleDetails() {
  const isHidden = statsDetails.classList.toggle('hidden');
  btnToggleDetails.classList.toggle('expanded', !isHidden);
}

/**
 * Build the session list inside the details card
 */
function buildSessionList(sessions) {
  statsDetailSessions.innerHTML = '';

  sessions.forEach((session, index) => {
    const row = document.createElement('div');
    row.className = 'session-row';
    row.dataset.sessionIndex = index;

    const startDate = new Date(session.startTime);
    const endDate = new Date(session.endTime);
    const duration = endDate - startDate;

    row.innerHTML = `
      <span class="session-row-label">Session ${index + 1}</span>
      <span class="session-row-date">${formatDate(startDate)}</span>
      <span class="session-row-duration">${formatDuration(duration)}</span>
    `;

    row.addEventListener('click', () => jumpToSession(index));

    statsDetailSessions.appendChild(row);
  });

  // Add scrollable class if more than 3 sessions (for fade hint)
  if (sessions.length > 3) {
    statsDetailSessions.classList.add('scrollable');
  } else {
    statsDetailSessions.classList.remove('scrollable');
  }
}

/**
 * Jump to a specific session
 */
function jumpToSession(sessionIndex) {
  const session = currentDocument.sessions[sessionIndex];
  if (!session) return;

  // Find the first event of this session
  const sessionStartEvent = flatEvents.findIndex(e => e.sessionId === session.id);
  if (sessionStartEvent >= 0) {
    seekToEvent(sessionStartEvent);
  }

  // Update active marker
  document.querySelectorAll('.session-row').forEach((m, i) => {
    m.classList.toggle('active', i === sessionIndex);
  });
}

/**
 * Start playback
 */
function startPlayback() {
  if (currentEventIndex >= flatEvents.length - 1) {
    resetPlayback();
  }

  isPlaying = true;
  btnPlay.disabled = true;
  btnPause.disabled = false;

  scheduleNextEvent();
}

/**
 * Pause playback
 */
function pausePlayback() {
  isPlaying = false;
  btnPlay.disabled = false;
  btnPause.disabled = true;

  if (playbackTimer) {
    clearTimeout(playbackTimer);
    playbackTimer = null;
  }
}

/**
 * Reset playback to beginning
 */
function resetPlayback() {
  pausePlayback();
  currentEventIndex = 0;
  replayContent = '';
  replayOrigins = [];
  replayDeletedContent = '';
  lastChangePosition = 0;
  replayEditor.innerHTML = '';
  replayProgress.value = 0;
  updateTimeDisplay();
  hideEventIndicator();
  updateActiveSessionMarker();
}

/**
 * Schedule the next event in playback.
 *
 * Intra-session pauses longer than PAUSE_THRESHOLD_MS are always skipped
 * and announced with a "SKIPPED Xs RUMINATION" toast. Inter-session gaps
 * are left to the existing SESSION STARTED toast (fired by applyEvent when
 * it processes the session_start event) and receive no rumination toast.
 * All other delays are scaled by FIXED_REPLAY_SPEED and capped at
 * MAX_INTER_EVENT_DELAY.
 */
function scheduleNextEvent() {
  if (!isPlaying || currentEventIndex >= flatEvents.length) {
    pausePlayback();
    return;
  }

  const currentEvent = flatEvents[currentEventIndex];
  const nextEvent = flatEvents[currentEventIndex + 1];

  // Apply current event
  applyEvent(currentEvent);

  // Update progress
  replayProgress.value = currentEventIndex;
  updateTimeDisplay();

  currentEventIndex++;

  if (nextEvent && isPlaying) {
    const realGap = nextEvent.timestamp - currentEvent.timestamp;
    let delay;

    const isInterSessionGap = nextEvent.type === 'session_start';

    if (realGap > PAUSE_THRESHOLD_MS && !isInterSessionGap) {
      // Skip this intra-session pause and show a rumination toast
      delay = MIN_DELAY;
      showEventIndicator(`Skipped ${formatPauseDuration(realGap)} Rumination`, 'pause');
    } else {
      // Normal delay — scale by fixed speed and cap
      delay = Math.min(realGap / FIXED_REPLAY_SPEED, MAX_INTER_EVENT_DELAY);
      delay = Math.max(delay, MIN_DELAY);
    }

    playbackTimer = setTimeout(scheduleNextEvent, delay);
  }
}

/**
 * Apply an event to the replay display
 */
function applyEvent(event) {
  switch (event.type) {
    case 'insert':
      if (event.content) {
        const before = replayContent.substring(0, event.position);
        const after = replayContent.substring(event.position);
        replayContent = before + event.content + after;
        const composedMarkers = new Array(event.content.length).fill('composed');
        replayOrigins.splice(event.position, 0, ...composedMarkers);
        lastChangePosition = event.position + event.content.length;
      }
      break;

    case 'delete':
      if (event.content) {
        const deleteLength = event.content.length;
        // Accumulate deleted content for cut+paste detection
        replayDeletedContent += replayContent.substring(event.position, event.position + deleteLength);
        const before = replayContent.substring(0, event.position);
        const after = replayContent.substring(event.position + deleteLength);
        replayContent = before + after;
        replayOrigins.splice(event.position, deleteLength);
        lastChangePosition = event.position;
      }
      break;

    case 'paste':
      if (event.content) {
        // Determine if this paste is internal (composed) or external (imported)
        const isInternal = replayContent.includes(event.content) || replayDeletedContent.includes(event.content);
        const marker = isInternal ? 'composed' : 'imported';

        const before = replayContent.substring(0, event.position);
        const after = replayContent.substring(event.position);
        replayContent = before + event.content + after;
        const markers = new Array(event.content.length).fill(marker);
        replayOrigins.splice(event.position, 0, ...markers);
        showEventIndicator(`Pasted ${event.content.length} chars`, 'paste');
        lastChangePosition = event.position + event.content.length;
      }
      break;

    case 'session_start':
      // Initialize content to session's base content (for multi-session documents)
      if (event.sessionBaseContent) {
        // Preserve existing origins if they match (carries forward imported markers from prior sessions)
        if (replayContent === event.sessionBaseContent && replayOrigins.length === event.sessionBaseContent.length && replayOrigins.length > 0) {
          // Keep existing replayOrigins — they reflect prior session replay
        } else {
          replayContent = event.sessionBaseContent;
          replayOrigins = new Array(event.sessionBaseContent.length).fill('composed');
        }
        replayDeletedContent = '';
      }
      // Reset cursor to top of document on session start
      lastChangePosition = 0;
      // Determine session number from document
      {
        const sessionNum = currentDocument
          ? currentDocument.sessions.findIndex(s => s.id === event.sessionId) + 1
          : 0;
        showEventIndicator(`Session ${sessionNum} Started`, 'session');
      }
      break;

    case 'session_end':
      break;
  }

  // Update display with paste highlighting and scroll to where the edit happened
  renderReplayContent();

  // Update the active session marker in the timeline
  updateActiveSessionMarker();
}

/**
 * Seek to a specific event
 */
function seekToEvent(targetIndex) {
  pausePlayback();

  // Rebuild content, origins, deletedContent, and lastChangePosition up to target event
  replayContent = '';
  replayOrigins = [];
  replayDeletedContent = '';
  let seekPosition = 0;

  for (let i = 0; i <= targetIndex; i++) {
    const event = flatEvents[i];

    switch (event.type) {
      case 'session_start':
        // Initialize content to session's base content (for multi-session documents)
        if (event.sessionBaseContent) {
          // Preserve existing origins if they match (carries forward imported markers from prior sessions)
          if (replayContent === event.sessionBaseContent && replayOrigins.length === event.sessionBaseContent.length && replayOrigins.length > 0) {
            // Keep existing replayOrigins — they reflect prior session replay
          } else {
            replayContent = event.sessionBaseContent;
            replayOrigins = new Array(event.sessionBaseContent.length).fill('composed');
          }
          replayDeletedContent = '';
        }
        seekPosition = 0;
        break;

      case 'insert':
        if (event.content) {
          const before = replayContent.substring(0, event.position);
          const after = replayContent.substring(event.position);
          replayContent = before + event.content + after;
          const composedMarkers = new Array(event.content.length).fill('composed');
          replayOrigins.splice(event.position, 0, ...composedMarkers);
          seekPosition = event.position + event.content.length;
        }
        break;

      case 'paste':
        if (event.content) {
          const isInternal = replayContent.includes(event.content) || replayDeletedContent.includes(event.content);
          const marker = isInternal ? 'composed' : 'imported';
          const before = replayContent.substring(0, event.position);
          const after = replayContent.substring(event.position);
          replayContent = before + event.content + after;
          const markers = new Array(event.content.length).fill(marker);
          replayOrigins.splice(event.position, 0, ...markers);
          seekPosition = event.position + event.content.length;
        }
        break;

      case 'delete':
        if (event.content) {
          const deleteLength = event.content.length;
          replayDeletedContent += replayContent.substring(event.position, event.position + deleteLength);
          const before = replayContent.substring(0, event.position);
          const after = replayContent.substring(event.position + deleteLength);
          replayContent = before + after;
          replayOrigins.splice(event.position, deleteLength);
          seekPosition = event.position;
        }
        break;
    }
  }

  lastChangePosition = seekPosition;
  currentEventIndex = targetIndex;
  renderReplayContent();
  replayProgress.value = targetIndex;
  updateTimeDisplay();
  updateActiveSessionMarker();
}

/**
 * Format a pause duration for the rumination toast.
 * e.g. 45 000 ms → "45s", 203 000 ms → "3m 23s"
 */
function formatPauseDuration(ms) {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/**
 * Handle progress slider seek
 */
function handleProgressSeek() {
  const targetIndex = parseInt(replayProgress.value, 10);
  seekToEvent(targetIndex);
}

/**
 * Update the time display
 *
 * Uses pre-computed cumulative writing times that collapse inter-session
 * gaps, so the timer reflects actual writing duration.
 */
function updateTimeDisplay() {
  if (flatEvents.length === 0) {
    replayTime.textContent = '0:00 / 0:00';
    return;
  }

  const idx = Math.min(currentEventIndex, flatEvents.length - 1);
  const currentTime = cumulativeTimes[idx] || 0;

  replayTime.textContent = `${formatDuration(currentTime)} / ${formatDuration(totalWritingTime)}`;
}

/**
 * Render replay content with paste highlighting and cursor tracking.
 * Builds HTML from replayContent + replayOrigins, wrapping contiguous
 * pasted regions in <span class="imported-content"> for visual distinction.
 * Injects a zero-size <span class="replay-cursor-marker"> at lastChangePosition
 * so the viewport can follow where actual edits are happening via scrollIntoView.
 */
function renderReplayContent() {
  if (replayContent.length === 0) {
    replayEditor.innerHTML = '';
    return;
  }

  const cursorPos = Math.min(lastChangePosition, replayContent.length);
  const CURSOR_MARKER = '<span class="replay-cursor-marker"></span>';
  let cursorInserted = false;

  // Build HTML by grouping contiguous runs of same origin,
  // breaking at cursorPos so the marker lands at the right character boundary.
  let html = '';
  let i = 0;
  while (i < replayContent.length) {
    // Emit cursor marker at cursorPos (before the character at this position)
    if (!cursorInserted && i === cursorPos) {
      html += CURSOR_MARKER;
      cursorInserted = true;
    }

    const origin = replayOrigins[i] || 'composed';
    let j = i;
    // Find end of contiguous run with same origin —
    // always break at cursorPos so the marker insertion point is respected
    while (j < replayContent.length && (replayOrigins[j] || 'composed') === origin) {
      if (!cursorInserted && j === cursorPos) break;
      j++;
    }

    const segment = replayContent.substring(i, j);
    const escaped = escapeHtml(segment);
    if (origin === 'imported') {
      html += `<span class="imported-content">${escaped}</span>`;
    } else {
      html += escaped;
    }
    i = j;
  }

  // Cursor at or beyond end of content
  if (!cursorInserted) {
    html += CURSOR_MARKER;
  }

  replayEditor.innerHTML = html;

  // Scroll the cursor marker into view so the viewport follows where edits happen
  const marker = replayEditor.querySelector('.replay-cursor-marker');
  if (marker) {
    marker.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
}

/**
 * Escape HTML special characters for safe innerHTML insertion
 */
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Show a floating event toast that rises and fades out.
 * Spawns a new element each time so multiple toasts can coexist.
 *
 * @param {string} text - Display text
 * @param {string} type - CSS modifier class ('paste' | 'session' | 'pause')
 */
function showEventIndicator(text, type) {
  const container = eventIndicator.parentElement;
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `event-toast ${type}`;
  toast.textContent = text;
  toast.style.animationDuration = '2800ms';

  container.appendChild(toast);

  // Remove from DOM after animation completes
  toast.addEventListener('animationend', () => toast.remove());
}

/**
 * Hide event indicator (clears any lingering toasts)
 */
function hideEventIndicator() {
  const container = eventIndicator.parentElement;
  if (!container) return;
  container.querySelectorAll('.event-toast').forEach(t => t.remove());
}

/**
 * Format date for display
 */
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Format duration for display
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Update the active session marker based on current playback position
 */
function updateActiveSessionMarker() {
  if (!currentDocument || flatEvents.length === 0) return;

  // Get the current event's session ID
  const currentEvent = flatEvents[currentEventIndex] || flatEvents[0];
  const currentSessionId = currentEvent.sessionId;

  // Find the session index
  const sessionIndex = currentDocument.sessions.findIndex(s => s.id === currentSessionId);

  // Update markers
  document.querySelectorAll('.session-row').forEach((row, index) => {
    row.classList.toggle('active', index === sessionIndex);
  });
}
