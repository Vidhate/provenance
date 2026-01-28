/**
 * Provenance - Main Application
 *
 * Ties together the editor, recorder, viewer, vault, and sidebar components.
 */

import { createEditor, getEditorContent, setEditorContent } from './editor.js';
import { createRecorderInstance, getRecordedEvents, loadExistingEvents } from './editorRecorder.js';
import { initViewer, loadProvenanceFile } from './viewer.js';
import { createProvenanceDocument, addSession, finalizeDocument, serialize, parse, validate, getStatistics } from '../../core/format.js';
import { initVault, isFileSystemAccessSupported, isVaultReady, showVaultPicker, openFileFromVault, saveFileToVault, createNewFileInVault } from './vault.js';
import { initSidebar, updateSidebarState, refreshSidebar, highlightActiveFile, clearActiveFile, setFileListMode } from './sidebar.js';
import { initAutosave, scheduleAutosave, resetAutosave, setSaveCallback } from './autosave.js';

// State
let currentDocument = null;
let currentSessionId = null;
let sessionStartTime = null;
let sessionBaseContent = ''; // Content at the start of current session
let recorder = null;
let sessionTimer = null;
let currentFileHandle = null; // File handle for vault-based saving
let currentFilename = null;

// DOM Elements
let navEditor, navViewer, editorView, viewerView, recordingStatus, docTitle;
let btnNew, btnOpen, btnSave, fileInput, openFileInput;
let charCount, wordCount, eventCount, sessionTime;
let onboardingModal, btnSkipOnboarding, btnSetupVault;
let browserWarning, btnDismissWarning;

/**
 * Initialize the application
 */
async function init() {
  // Get DOM elements
  getDOMElements();

  // Initialize editor
  await createEditor(document.getElementById('editor'), {
    onChange: handleEditorChange
  });

  // Initialize recorder
  recorder = createRecorderInstance();

  // Initialize viewer
  initViewer();

  // Initialize sidebar with file select callbacks for both modes
  initSidebar({
    onFileSelect: handleFileSelectFromSidebar,
    onFileSelectForViewer: handleFileSelectForViewer
  });

  // Initialize autosave
  initAutosave({
    onSave: performAutosave
  });

  // Check browser compatibility and initialize vault
  if (isFileSystemAccessSupported()) {
    const vaultReady = await initVault();

    if (vaultReady) {
      updateSidebarState(true);
    } else {
      // Check if this is first visit
      const hasVisited = localStorage.getItem('provenance-visited');
      if (!hasVisited) {
        showOnboardingModal();
      } else {
        updateSidebarState(false);
      }
    }
  } else {
    // Show browser compatibility warning
    showBrowserWarning();
    updateSidebarState(false);
  }

  // Create new document
  newDocument();

  // Setup event listeners
  setupEventListeners();

  // Start session timer
  startSessionTimer();

  console.log('Provenance initialized');
}

/**
 * Get all required DOM elements
 */
function getDOMElements() {
  navEditor = document.getElementById('nav-editor');
  navViewer = document.getElementById('nav-viewer');
  editorView = document.getElementById('editor-view');
  viewerView = document.getElementById('viewer-view');
  recordingStatus = document.getElementById('recording-status');
  docTitle = document.getElementById('doc-title');
  btnNew = document.getElementById('btn-new');
  btnOpen = document.getElementById('btn-open');
  btnSave = document.getElementById('btn-save');
  fileInput = document.getElementById('file-input');
  openFileInput = document.getElementById('open-file-input');
  charCount = document.getElementById('char-count');
  wordCount = document.getElementById('word-count');
  eventCount = document.getElementById('event-count');
  sessionTime = document.getElementById('session-time');
  onboardingModal = document.getElementById('onboarding-modal');
  btnSkipOnboarding = document.getElementById('btn-skip-onboarding');
  btnSetupVault = document.getElementById('btn-setup-vault');
  browserWarning = document.getElementById('browser-warning');
  btnDismissWarning = document.getElementById('btn-dismiss-warning');
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
  docTitle.addEventListener('input', handleTitleChange);

  // Onboarding modal
  if (btnSkipOnboarding) {
    btnSkipOnboarding.addEventListener('click', handleSkipOnboarding);
  }
  if (btnSetupVault) {
    btnSetupVault.addEventListener('click', handleSetupVault);
  }

  // Browser warning
  if (btnDismissWarning) {
    btnDismissWarning.addEventListener('click', hideBrowserWarning);
  }

  // Handle page unload - warn about unsaved changes
  window.addEventListener('beforeunload', (e) => {
    const events = getRecordedEvents();
    if (events && events.length > 0 && !currentFileHandle) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/**
 * Handle title input changes
 */
function handleTitleChange() {
  if (currentDocument) {
    currentDocument.metadata.title = docTitle.value || 'Untitled';
  }
  // Schedule autosave when title changes
  if (currentFileHandle) {
    scheduleAutosave(getEditorContent(), true);
  }
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
    // Update sidebar to use editor file handlers
    setFileListMode('editor');
  } else {
    editorView.classList.remove('active');
    viewerView.classList.add('active');
    navEditor.classList.remove('active');
    navViewer.classList.add('active');
    // Update sidebar to use viewer file handlers
    setFileListMode('viewer');
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
  currentFileHandle = null; // No file handle for new document
  currentFilename = null;

  // Clear editor
  setEditorContent('');

  // Reset recorder
  recorder.reset();
  recorder.startSession();

  // Reset autosave
  resetAutosave('');

  // Update UI
  docTitle.value = '';
  recordingStatus.textContent = 'Recording';
  recordingStatus.classList.add('recording');

  // Clear active file in sidebar
  clearActiveFile();

  updateStatusBar();
}

/**
 * Confirm before creating new document
 */
function confirmNewDocument() {
  const events = getRecordedEvents();
  if (events && events.length > 10 && !currentFileHandle) {
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

  // Schedule autosave if we have a file handle
  if (currentFileHandle) {
    scheduleAutosave(content, true);
  }
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
 * Save the current document
 * Uses vault if available, otherwise falls back to download
 */
async function saveDocument() {
  const content = getEditorContent();
  const events = getRecordedEvents();

  if (!events || events.length === 0) {
    alert('No writing recorded yet. Start typing to record your writing process.');
    return;
  }

  // Prepare document for saving
  const endTime = Date.now();
  addSession(currentDocument, currentSessionId, sessionStartTime, endTime, events, sessionBaseContent);
  await finalizeDocument(currentDocument, content);
  currentDocument.metadata.title = docTitle.value || 'Untitled';

  // Try vault-based save first
  if (isVaultReady()) {
    try {
      if (currentFileHandle) {
        // Save to existing file
        await saveFileToVault(currentDocument, currentFileHandle);
      } else {
        // Create new file in vault
        const filename = docTitle.value || 'Untitled';
        currentFileHandle = await createNewFileInVault(currentDocument, filename);
        currentFilename = currentFileHandle.name;
        highlightActiveFile(currentFilename);
      }

      // Refresh sidebar to show updated file
      refreshSidebar();

      console.log('Document saved to vault');
    } catch (err) {
      console.error('Vault save failed, falling back to download:', err);
      downloadDocument();
    }
  } else {
    // Fall back to download
    downloadDocument();
  }

  // Start a new session (continuing the document)
  startNewSession(content);
}

/**
 * Download document as file (fallback for non-vault save)
 */
function downloadDocument() {
  const json = serialize(currentDocument);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(currentDocument.metadata.title)}.provenance`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log('Document downloaded');
}

/**
 * Perform autosave (called by autosave module)
 */
async function performAutosave(content) {
  if (!currentFileHandle) return;

  const events = getRecordedEvents();
  if (!events || events.length === 0) return;

  // Prepare document for saving
  const endTime = Date.now();

  // Create a copy of the document for saving
  const docToSave = JSON.parse(JSON.stringify(currentDocument));
  addSession(docToSave, currentSessionId, sessionStartTime, endTime, events, sessionBaseContent);
  await finalizeDocument(docToSave, content);
  docToSave.metadata.title = docTitle.value || 'Untitled';

  // Save to vault
  await saveFileToVault(docToSave, currentFileHandle);

  // Update the current document state
  currentDocument = docToSave;

  // Start a new session
  startNewSession(content);

  // Refresh sidebar to show updated modification time
  refreshSidebar();
}

/**
 * Start a new session after saving
 */
function startNewSession(content) {
  currentSessionId = generateSessionId();
  sessionStartTime = Date.now();
  sessionBaseContent = content;
  recorder.reset();
  recorder.setBaseContent(content);
  recorder.startSession();
  resetAutosave(content);
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'untitled';
}

/**
 * Handle file selection from sidebar
 */
async function handleFileSelectFromSidebar(fileHandle, filename) {
  // Check for unsaved changes
  const events = getRecordedEvents();
  if (events && events.length > 10 && !currentFileHandle) {
    if (!confirm('You have unsaved work. Open a different document anyway?')) {
      return;
    }
  }

  try {
    const { document: doc } = await openFileFromVault(fileHandle);

    // Load into editor
    currentDocument = doc;
    currentFileHandle = fileHandle;
    currentFilename = filename;
    setEditorContent(doc.finalContent || '');
    docTitle.value = doc.metadata.title || '';

    // Load existing events for reference
    const allEvents = [];
    for (const session of doc.sessions) {
      allEvents.push(...session.events);
    }
    loadExistingEvents(allEvents);

    // Start new session
    currentSessionId = generateSessionId();
    sessionStartTime = Date.now();
    sessionBaseContent = doc.finalContent || '';
    recorder.reset();
    recorder.setBaseContent(sessionBaseContent);
    recorder.startSession();

    // Reset autosave with new content
    resetAutosave(sessionBaseContent);

    // Update UI
    updatePreview(doc.finalContent || '');
    updateStatusBar();
    highlightActiveFile(filename);

    console.log('Document opened from sidebar');
  } catch (err) {
    alert('Error opening file: ' + err.message);
    console.error(err);
  }
}

/**
 * Handle file selection from sidebar for viewing/verification
 */
async function handleFileSelectForViewer(fileHandle, filename) {
  try {
    const { document: doc } = await openFileFromVault(fileHandle);

    // Load into viewer
    await loadProvenanceFile(doc);

    // Highlight the file in sidebar
    highlightActiveFile(filename);

    console.log('Document opened in viewer from sidebar');
  } catch (err) {
    alert('Error opening file for viewing: ' + err.message);
    console.error(err);
  }
}

/**
 * Handle opening a .provenance file for continued editing (via file input)
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
    currentFileHandle = null; // No file handle for file input
    currentFilename = null;
    setEditorContent(doc.finalContent || '');
    docTitle.value = doc.metadata.title || '';

    // Load existing events for reference
    const allEvents = [];
    for (const session of doc.sessions) {
      allEvents.push(...session.events);
    }
    loadExistingEvents(allEvents);

    // Start new session
    currentSessionId = generateSessionId();
    sessionStartTime = Date.now();
    sessionBaseContent = doc.finalContent || '';
    recorder.reset();
    recorder.setBaseContent(sessionBaseContent);
    recorder.startSession();

    // Reset autosave
    resetAutosave(sessionBaseContent);

    // Update UI
    updatePreview(doc.finalContent || '');
    updateStatusBar();
    clearActiveFile();

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

/**
 * Show onboarding modal
 */
function showOnboardingModal() {
  if (onboardingModal) {
    onboardingModal.classList.remove('hidden');
  }
}

/**
 * Hide onboarding modal
 */
function hideOnboardingModal() {
  if (onboardingModal) {
    onboardingModal.classList.add('hidden');
  }
}

/**
 * Handle skip onboarding
 */
function handleSkipOnboarding() {
  localStorage.setItem('provenance-visited', 'true');
  hideOnboardingModal();
  updateSidebarState(false);
}

/**
 * Handle setup vault from onboarding
 */
async function handleSetupVault() {
  try {
    const handle = await showVaultPicker();
    if (handle) {
      localStorage.setItem('provenance-visited', 'true');
      hideOnboardingModal();
      updateSidebarState(true);
    }
  } catch (err) {
    console.error('Vault setup failed:', err);
  }
}

/**
 * Show browser compatibility warning
 */
function showBrowserWarning() {
  if (browserWarning) {
    browserWarning.classList.remove('hidden');
  }
}

/**
 * Hide browser compatibility warning
 */
function hideBrowserWarning() {
  if (browserWarning) {
    browserWarning.classList.add('hidden');
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
