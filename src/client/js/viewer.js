/**
 * Viewer module - Replay and verify provenance files
 *
 * Provides playback of the writing process with speed controls,
 * visual indicators for different event types, and verification status.
 */

import { validate, getStatistics } from '../../core/format.js';

// State
let currentDocument = null;
let allEvents = [];
let flatEvents = []; // All events flattened with absolute timestamps
let currentEventIndex = 0;
let isPlaying = false;
let playbackSpeed = 5;
let playbackTimer = null;
let replayContent = '';

// DOM Elements
let viewerEmpty, viewerContent, viewerTitle, viewerStats;
let verificationStatus, btnPlay, btnPause, btnReset;
let replaySpeed, replayProgress, replayTime;
let replayEditor, eventIndicator, sessionTimeline;

/**
 * Initialize the viewer
 */
export function initViewer() {
  // Get DOM elements
  viewerEmpty = document.getElementById('viewer-empty');
  viewerContent = document.getElementById('viewer-content');
  viewerTitle = document.getElementById('viewer-title');
  viewerStats = document.getElementById('viewer-stats');
  verificationStatus = document.getElementById('verification-status');
  btnPlay = document.getElementById('btn-play');
  btnPause = document.getElementById('btn-pause');
  btnReset = document.getElementById('btn-reset');
  replaySpeed = document.getElementById('replay-speed');
  replayProgress = document.getElementById('replay-progress');
  replayTime = document.getElementById('replay-time');
  replayEditor = document.getElementById('replay-editor');
  eventIndicator = document.getElementById('event-indicator');
  sessionTimeline = document.getElementById('session-timeline');

  // Setup event listeners
  btnPlay.addEventListener('click', startPlayback);
  btnPause.addEventListener('click', pausePlayback);
  btnReset.addEventListener('click', resetPlayback);
  replaySpeed.addEventListener('change', handleSpeedChange);
  replayProgress.addEventListener('input', handleProgressSeek);
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

  // Update UI
  viewerTitle.textContent = doc.metadata.title || 'Untitled';

  viewerStats.innerHTML = `
    <div class="stat">
      <span class="stat-value">${stats.sessionCount}</span>
      <span class="stat-label">Sessions</span>
    </div>
    <div class="stat">
      <span class="stat-value">${stats.totalEvents}</span>
      <span class="stat-label">Events</span>
    </div>
    <div class="stat">
      <span class="stat-value">${stats.totalCharsTyped}</span>
      <span class="stat-label">Characters Typed</span>
    </div>
    <div class="stat">
      <span class="stat-value">${stats.pasteEvents}</span>
      <span class="stat-label">Paste Events</span>
    </div>
    <div class="stat">
      <span class="stat-value">${stats.totalWritingTimeFormatted}</span>
      <span class="stat-label">Writing Time</span>
    </div>
    <div class="stat">
      <span class="stat-value">${(stats.pasteRatio * 100).toFixed(1)}%</span>
      <span class="stat-label">Paste Ratio</span>
    </div>
  `;

  // Build session timeline
  buildSessionTimeline(doc.sessions);

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

  // Update progress slider
  replayProgress.max = flatEvents.length - 1;
}

/**
 * Build the session timeline UI
 */
function buildSessionTimeline(sessions) {
  sessionTimeline.innerHTML = '';

  sessions.forEach((session, index) => {
    const marker = document.createElement('div');
    marker.className = 'session-marker';
    marker.dataset.sessionIndex = index;

    const startDate = new Date(session.startTime);
    const endDate = new Date(session.endTime);
    const duration = endDate - startDate;

    marker.innerHTML = `
      <span class="session-date">Session ${index + 1}: ${formatDate(startDate)}</span>
      <span class="session-duration">${formatDuration(duration)}</span>
    `;

    marker.addEventListener('click', () => jumpToSession(index));

    sessionTimeline.appendChild(marker);
  });
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
  document.querySelectorAll('.session-marker').forEach((m, i) => {
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
  replayEditor.textContent = '';
  replayProgress.value = 0;
  updateTimeDisplay();
  hideEventIndicator();
  updateActiveSessionMarker();
}

/**
 * Schedule the next event in playback
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

  // Schedule next event
  if (nextEvent && isPlaying) {
    let delay = nextEvent.timestamp - currentEvent.timestamp;

    // Apply speed multiplier
    delay = delay / playbackSpeed;

    // Cap maximum delay (for long pauses)
    if (playbackSpeed >= 50) {
      // "Skip pauses" mode
      delay = Math.min(delay, 50);
    } else {
      delay = Math.min(delay, 2000 / playbackSpeed);
    }

    // Minimum delay for visibility
    delay = Math.max(delay, 10);

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
      }
      break;

    case 'delete':
      if (event.content) {
        const deleteLength = event.content.length;
        const before = replayContent.substring(0, event.position);
        const after = replayContent.substring(event.position + deleteLength);
        replayContent = before + after;
        showEventIndicator('Deleted', 'delete');
      }
      break;

    case 'paste':
      if (event.content) {
        const before = replayContent.substring(0, event.position);
        const after = replayContent.substring(event.position);
        replayContent = before + event.content + after;
        showEventIndicator(`Pasted ${event.content.length} chars`, 'paste');
      }
      break;

    case 'session_start':
      // Initialize content to session's base content (for multi-session documents)
      if (event.sessionBaseContent) {
        replayContent = event.sessionBaseContent;
      }
      showEventIndicator('Session started', 'session');
      break;

    case 'session_end':
      showEventIndicator('Session ended', 'session');
      break;
  }

  // Update display
  replayEditor.textContent = replayContent;

  // Scroll to bottom if content is long
  replayEditor.scrollTop = replayEditor.scrollHeight;

  // Update the active session marker in the timeline
  updateActiveSessionMarker();
}

/**
 * Seek to a specific event
 */
function seekToEvent(targetIndex) {
  pausePlayback();

  // Rebuild content up to target event
  replayContent = '';
  for (let i = 0; i <= targetIndex; i++) {
    const event = flatEvents[i];

    switch (event.type) {
      case 'session_start':
        // Initialize content to session's base content (for multi-session documents)
        if (event.sessionBaseContent) {
          replayContent = event.sessionBaseContent;
        }
        break;

      case 'insert':
      case 'paste':
        if (event.content) {
          const before = replayContent.substring(0, event.position);
          const after = replayContent.substring(event.position);
          replayContent = before + event.content + after;
        }
        break;

      case 'delete':
        if (event.content) {
          const deleteLength = event.content.length;
          const before = replayContent.substring(0, event.position);
          const after = replayContent.substring(event.position + deleteLength);
          replayContent = before + after;
        }
        break;
    }
  }

  currentEventIndex = targetIndex;
  replayEditor.textContent = replayContent;
  replayProgress.value = targetIndex;
  updateTimeDisplay();
  updateActiveSessionMarker();
}

/**
 * Handle speed change
 */
function handleSpeedChange() {
  playbackSpeed = parseInt(replaySpeed.value, 10);
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
 */
function updateTimeDisplay() {
  if (flatEvents.length === 0) {
    replayTime.textContent = '0:00 / 0:00';
    return;
  }

  const currentEvent = flatEvents[currentEventIndex] || flatEvents[0];
  const firstEvent = flatEvents[0];
  const lastEvent = flatEvents[flatEvents.length - 1];

  const currentTime = currentEvent.timestamp - firstEvent.timestamp;
  const totalTime = lastEvent.timestamp - firstEvent.timestamp;

  replayTime.textContent = `${formatDuration(currentTime)} / ${formatDuration(totalTime)}`;
}

/**
 * Show event indicator
 */
function showEventIndicator(text, type) {
  eventIndicator.textContent = text;
  eventIndicator.className = `event-indicator visible ${type}`;

  // Auto-hide after delay
  setTimeout(() => {
    eventIndicator.classList.remove('visible');
  }, 1500);
}

/**
 * Hide event indicator
 */
function hideEventIndicator() {
  eventIndicator.classList.remove('visible');
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
  document.querySelectorAll('.session-marker').forEach((marker, index) => {
    marker.classList.toggle('active', index === sessionIndex);
  });
}
