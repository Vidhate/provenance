/**
 * Provenance - Main Application
 *
 * Ties together the editor, recorder, and viewer components.
 */

import { createEditor, getEditorContent, setEditorContent } from './editor.js';
import { createRecorderInstance, getRecordedEvents, loadExistingEvents } from './editorRecorder.js';
import { initViewer, loadProvenanceFile } from './viewer.js';
import { createProvenanceDocument, addSession, finalizeDocument, serialize, parse, validate, getStatistics } from '../../core/format.js';

// State
let currentDocument = null;
let currentSessionId = null;
let sessionStartTime = null;
let sessionBaseContent = ''; // Content at the start of current session
let recorder = null;
let sessionTimer = null;

// DOM Elements
const navEditor = document.getElementById('nav-editor');
const navViewer = document.getElementById('nav-viewer');
const editorView = document.getElementById('editor-view');
const viewerView = document.getElementById('viewer-view');
const recordingStatus = document.getElementById('recording-status');
const docTitle = document.getElementById('doc-title');
const btnNew = document.getElementById('btn-new');
const btnOpen = document.getElementById('btn-open');
const btnSave = document.getElementById('btn-save');
const fileInput = document.getElementById('file-input');
const openFileInput = document.getElementById('open-file-input');
const charCount = document.getElementById('char-count');
const wordCount = document.getElementById('word-count');
const eventCount = document.getElementById('event-count');
const sessionTime = document.getElementById('session-time');

/**
 * Initialize the application
 */
async function init() {
  // Initialize editor
  await createEditor(document.getElementById('editor'), {
    onChange: handleEditorChange
  });

  // Initialize recorder
  recorder = createRecorderInstance();

  // Initialize viewer
  initViewer();

  // Create new document
  newDocument();

  // Setup event listeners
  setupEventListeners();

  // Start session timer
  startSessionTimer();

  console.log('Provenance initialized');
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
  // Navigation
  navEditor.addEventListener('click', () => switchView('editor'));
  navViewer.addEventListener('click', () => switchView('viewer'));

  // Editor toolbar
  btnNew.addEventListener('click', confirmNewDocument);
  btnOpen.addEventListener('click', () => openFileInput.click());
  btnSave.addEventListener('click', saveDocument);

  // File inputs
  fileInput.addEventListener('change', handleFileLoad);
  openFileInput.addEventListener('change', handleOpenFile);

  // Document title
  docTitle.addEventListener('input', () => {
    if (currentDocument) {
      currentDocument.metadata.title = docTitle.value || 'Untitled';
    }
  });

  // Handle page unload - warn about unsaved changes
  window.addEventListener('beforeunload', (e) => {
    const events = getRecordedEvents();
    if (events && events.length > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/**
 * Switch between editor and viewer views
 */
function switchView(view) {
  if (view === 'editor') {
    editorView.classList.add('active');
    viewerView.classList.remove('active');
    navEditor.classList.add('active');
    navViewer.classList.remove('active');
  } else {
    editorView.classList.remove('active');
    viewerView.classList.add('active');
    navEditor.classList.remove('active');
    navViewer.classList.add('active');
  }
}

/**
 * Create a new document
 */
function newDocument() {
  currentDocument = createProvenanceDocument('Untitled');
  currentSessionId = generateSessionId();
  sessionStartTime = Date.now();
  sessionBaseContent = ''; // New document starts empty

  // Clear editor
  setEditorContent('');

  // Reset recorder
  recorder.reset();
  recorder.startSession();

  // Update UI
  docTitle.value = '';
  recordingStatus.textContent = 'Recording';
  recordingStatus.classList.add('recording');

  updateStatusBar();
}

/**
 * Confirm before creating new document
 */
function confirmNewDocument() {
  const events = getRecordedEvents();
  if (events && events.length > 10) {
    if (!confirm('You have unsaved work. Create a new document anyway?')) {
      return;
    }
  }
  newDocument();
}

/**
 * Handle editor content changes
 */
function handleEditorChange(content) {
  // Update preview
  updatePreview(content);

  // Update status bar
  updateStatusBar();
}

/**
 * Update the markdown preview
 */
function updatePreview(content) {
  const preview = document.getElementById('preview');
  if (preview) {
    preview.innerHTML = renderMarkdown(content);
  }
}

/**
 * Simple markdown renderer
 */
function renderMarkdown(text) {
  if (!text) return '';

  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.*$)/gm, '<h3>$1</h3>')
    .replace(/^## (.*$)/gm, '<h2>$1</h2>')
    .replace(/^# (.*$)/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    // Blockquotes
    .replace(/^> (.*$)/gm, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^[\*\-] (.*$)/gm, '<li>$1</li>')
    // Paragraphs (double newlines)
    .replace(/\n\n/g, '</p><p>')
    // Line breaks
    .replace(/\n/g, '<br>');

  // Wrap in paragraph if not already wrapped
  if (html && !html.startsWith('<')) {
    html = '<p>' + html + '</p>';
  }

  return html;
}

/**
 * Update the status bar
 */
function updateStatusBar() {
  const content = getEditorContent();
  const events = getRecordedEvents();

  charCount.textContent = `${content.length} characters`;
  wordCount.textContent = `${countWords(content)} words`;
  eventCount.textContent = `${events ? events.length : 0} events recorded`;
}

/**
 * Count words in text
 */
function countWords(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

/**
 * Start the session timer
 */
function startSessionTimer() {
  sessionTimer = setInterval(() => {
    if (sessionStartTime) {
      const elapsed = Date.now() - sessionStartTime;
      sessionTime.textContent = `Session: ${formatTime(elapsed)}`;
    }
  }, 1000);
}

/**
 * Format milliseconds as MM:SS or HH:MM:SS
 */
function formatTime(ms) {
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
 * Generate a unique session ID
 */
function generateSessionId() {
  return 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/**
 * Save the current document as a .provenance file
 */
async function saveDocument() {
  const content = getEditorContent();
  const events = getRecordedEvents();

  if (!events || events.length === 0) {
    alert('No writing recorded yet. Start typing to record your writing process.');
    return;
  }

  // End current session
  const endTime = Date.now();

  // Add session to document with the base content that existed at session start
  addSession(currentDocument, currentSessionId, sessionStartTime, endTime, events, sessionBaseContent);

  // Finalize document
  await finalizeDocument(currentDocument, content);

  // Update title
  currentDocument.metadata.title = docTitle.value || 'Untitled';

  // Serialize
  const json = serialize(currentDocument);

  // Download
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(currentDocument.metadata.title)}.provenance`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Start a new session (continuing the document)
  currentSessionId = generateSessionId();
  sessionStartTime = Date.now();
  sessionBaseContent = content; // New session starts with current content
  recorder.reset();
  recorder.startSession();

  console.log('Document saved');
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'untitled';
}

/**
 * Handle opening a .provenance file for continued editing
 */
async function handleOpenFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const doc = parse(text);

    // Validate
    const validation = await validate(doc);
    if (!validation.valid) {
      alert('Warning: This file has validation errors:\n' + validation.errors.join('\n'));
    }

    // Load into editor
    currentDocument = doc;
    setEditorContent(doc.finalContent || '');
    docTitle.value = doc.metadata.title || '';

    // Load existing events for reference
    const allEvents = [];
    for (const session of doc.sessions) {
      allEvents.push(...session.events);
    }
    loadExistingEvents(allEvents);

    // Start new session - base content is the existing document content
    currentSessionId = generateSessionId();
    sessionStartTime = Date.now();
    sessionBaseContent = doc.finalContent || ''; // Session starts with existing content
    recorder.reset();
    recorder.startSession();

    updatePreview(doc.finalContent || '');
    updateStatusBar();

    console.log('Document opened for editing');
  } catch (err) {
    alert('Error opening file: ' + err.message);
    console.error(err);
  }

  // Reset file input
  event.target.value = '';
}

/**
 * Handle loading a .provenance file for viewing
 */
async function handleFileLoad(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const doc = parse(text);

    // Switch to viewer and load
    switchView('viewer');
    await loadProvenanceFile(doc);
  } catch (err) {
    alert('Error loading file: ' + err.message);
    console.error(err);
  }

  // Reset file input
  event.target.value = '';
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
