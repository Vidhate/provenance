/**
 * Provenance - Main Application
 *
 * Ties together the editor, recorder, viewer, vault, and sidebar components.
 */

import { createEditor, getEditorContent, setEditorContent } from './editor.js';
import { createRecorderInstance, getRecordedEvents } from './editorRecorder.js';
import { initViewer, loadProvenanceFile } from './viewer.js';
import { createProvenanceDocument, addSession, finalizeDocument, serialize, parse, validate, getStatistics } from '../../core/format.js';
import { initVault, isFileSystemAccessSupported, isVaultReady, showVaultPicker, openFileFromVault, saveFileToVault, createNewFileInVault, renameFileInVault, deleteFileFromVault } from './vault.js';
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
let btnNew, fileInput;
let charCount, wordCount, eventCount, sessionTime;
let onboardingModal, btnSkipOnboarding, btnSetupVault;
let browserWarning, btnDismissWarning;

// Flags to track document state
let pendingAutoCreate = false;  // File not yet created in vault
let workHasBegun = false;       // User has typed at least one character

// Rename debouncing and locking
let renameDebounceTimer = null;
let isRenaming = false;
let lastRenamedTitle = null; // Track what title we last renamed to
const RENAME_DEBOUNCE_DELAY = 1500; // Wait 1.5 seconds after user stops typing to rename

// Flag to prevent handleEditorChange from triggering auto-create during file load
let isLoadingDocument = false;

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
    onFileSelectForViewer: handleFileSelectForViewer,
    onFileDelete: handleFileDelete
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
  fileInput = document.getElementById('file-input');
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

  // File inputs
  fileInput.addEventListener('change', handleFileLoad);

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

  // Debounce the rename operation to avoid race conditions
  // when user is typing quickly in the title field
  if (currentFileHandle && isVaultReady()) {
    // Clear any pending rename
    if (renameDebounceTimer) {
      clearTimeout(renameDebounceTimer);
    }

    // Schedule rename after delay - only if title has actually changed from last rename
    const currentTitle = docTitle.value || 'Untitled';
    if (currentTitle !== lastRenamedTitle) {
      renameDebounceTimer = setTimeout(() => {
        performDebouncedRename();
      }, RENAME_DEBOUNCE_DELAY);
    }

    // Schedule autosave when title changes (this is already debounced)
    scheduleAutosave(getEditorContent(), true);
  }
}

/**
 * Perform the actual rename after debounce delay
 */
async function performDebouncedRename() {
  // Don't rename if another rename is in progress
  if (isRenaming || !currentFileHandle) return;

  const newTitle = docTitle.value || 'Untitled';
  const expectedFilename = sanitizeFilename(newTitle) + '.provenance';

  // Only rename if filename would actually change
  if (!currentFilename || currentFilename === expectedFilename) {
    // Update lastRenamedTitle even if no actual rename needed (filename already matches)
    lastRenamedTitle = newTitle;
    return;
  }

  // Skip if title hasn't changed from last successful rename
  if (newTitle === lastRenamedTitle) {
    return;
  }

  isRenaming = true;

  try {
    const newHandle = await renameFileInVault(currentFileHandle, newTitle);
    if (newHandle) {
      currentFileHandle = newHandle;
      currentFilename = newHandle.name;
      lastRenamedTitle = newTitle; // Track successful rename

      // Also save the document with the updated title so sidebar shows correct name
      // The sidebar reads title from file's internal metadata, not filename
      const content = getEditorContent();
      const events = getRecordedEvents();
      if (events && events.length > 0) {
        const endTime = Date.now();
        const docToSave = JSON.parse(JSON.stringify(currentDocument));

        // Update existing session or add new one (same logic as autosave)
        const existingSessionIndex = docToSave.sessions.findIndex(s => s.id === currentSessionId);
        if (existingSessionIndex >= 0) {
          docToSave.sessions[existingSessionIndex] = {
            id: currentSessionId,
            startTime: new Date(sessionStartTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            baseContent: sessionBaseContent,
            events: events
          };
        } else {
          addSession(docToSave, currentSessionId, sessionStartTime, endTime, events, sessionBaseContent);
        }

        await finalizeDocument(docToSave, content);
        docToSave.metadata.title = newTitle;
        await saveFileToVault(docToSave, currentFileHandle);
        currentDocument = docToSave;
        // Note: We do NOT start a new session here - continue the current one
      }

      highlightActiveFile(currentFilename);
      await refreshSidebar();
    }
  } catch (err) {
    console.error('Error renaming file:', err);
  } finally {
    isRenaming = false;
  }
}

/**
 * Auto-create a file in the vault for new documents
 * Only called when work has actually begun (first keystroke)
 */
async function autoCreateFile() {
  if (!isVaultReady() || !workHasBegun) return;

  try {
    const title = docTitle.value || 'Untitled';
    currentFileHandle = await createNewFileInVault(currentDocument, title);
    currentFilename = currentFileHandle.name;
    lastRenamedTitle = title; // Track the initial title to prevent spurious renames

    // Highlight in sidebar and refresh list
    highlightActiveFile(currentFilename);
    await refreshSidebar();

    console.log('Auto-created file:', currentFilename);
  } catch (err) {
    console.error('Error auto-creating file:', err);
    // Don't block the user if auto-create fails
  }
}

/**
 * Handle file deletion from sidebar
 */
async function handleFileDelete(fileHandle, filename) {
  // Confirm deletion
  const confirmed = confirm(
    `Are you sure you want to delete "${filename.replace('.provenance', '')}"?\n\n` +
    'This action cannot be undone. The file and all its writing history will be permanently deleted.'
  );

  if (!confirmed) return;

  try {
    await deleteFileFromVault(fileHandle);

    // Refresh sidebar first to remove the deleted file from the list
    await refreshSidebar();

    // If this was the current file, create a new document
    if (currentFilename === filename) {
      newDocument();
    }

    console.log('File deleted:', filename);
  } catch (err) {
    alert('Error deleting file: ' + err.message);
    console.error(err);
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
  // Cancel any pending rename from previous document
  if (renameDebounceTimer) {
    clearTimeout(renameDebounceTimer);
    renameDebounceTimer = null;
  }

  currentDocument = createProvenanceDocument('Untitled');
  currentSessionId = generateSessionId();
  sessionStartTime = null; // Will be set when work begins
  sessionBaseContent = ''; // New document starts empty
  currentFileHandle = null; // No file handle for new document
  currentFilename = null;
  pendingAutoCreate = true; // Mark for auto-create on first content change
  workHasBegun = false; // No work yet
  lastRenamedTitle = null; // Reset rename tracking for new document

  // Clear editor
  setEditorContent('');

  // Reset recorder but DON'T start session yet
  recorder.reset();
  // Session will start when first keystroke is captured

  // Reset autosave
  resetAutosave('');

  // Update UI
  docTitle.value = '';
  recordingStatus.textContent = 'Ready';
  recordingStatus.classList.remove('recording');

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
 *
 * This is called whenever the editor content changes. It detects the first
 * actual edit (when content differs from sessionBaseContent) and starts
 * the recording session at that point.
 */
async function handleEditorChange(content) {
  // Update preview
  updatePreview(content);

  // Update status bar
  updateStatusBar();

  // Skip session logic when loading an existing document
  if (isLoadingDocument) {
    return;
  }

  // Check if this is the first real edit (work has begun)
  // We consider work to have begun if content has changed from the base content
  // For new documents, sessionBaseContent is '' so any content means work began
  // For existing documents, content must differ from the loaded content
  if (!workHasBegun && content !== sessionBaseContent) {
    workHasBegun = true;
    sessionStartTime = Date.now();

    // Start recording session now - MUST await to ensure session_start hash is computed
    // before any insert/delete events are recorded
    await recorder.startSession();

    // Update UI to show recording
    recordingStatus.textContent = 'Recording';
    recordingStatus.classList.add('recording');

    // Auto-create file in vault if ready (only for new documents)
    if (pendingAutoCreate && isVaultReady()) {
      pendingAutoCreate = false;
      await autoCreateFile();
    }
  }

  // Schedule autosave if we have a file handle AND work has begun
  if (currentFileHandle && workHasBegun) {
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
 *
 * Note: Manual save also does NOT create a new session - it updates the current one.
 * A session only ends when the user closes the file or opens a different one.
 */
async function saveDocument() {
  const content = getEditorContent();
  const events = getRecordedEvents();

  if (!events || events.length === 0) {
    alert('No writing recorded yet. Start typing to record your writing process.');
    return;
  }

  // Prepare document for saving - update existing session or add new one
  const endTime = Date.now();

  // Check if we're updating an existing session or adding a new one
  const existingSessionIndex = currentDocument.sessions.findIndex(s => s.id === currentSessionId);
  if (existingSessionIndex >= 0) {
    // Update existing session
    currentDocument.sessions[existingSessionIndex] = {
      id: currentSessionId,
      startTime: new Date(sessionStartTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      baseContent: sessionBaseContent,
      events: events
    };
  } else {
    // First save of this session
    addSession(currentDocument, currentSessionId, sessionStartTime, endTime, events, sessionBaseContent);
  }

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

  // Note: We do NOT start a new session - continue the current one
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
 *
 * IMPORTANT: Autosave does NOT create a new session. It saves the current
 * session's progress so far. A session represents a single "sitting" - from
 * when the user opens a file and starts editing to when they close it or
 * open a different file.
 */
async function performAutosave(content) {
  // Don't save if no file handle or work hasn't begun
  if (!currentFileHandle || !workHasBegun) return;

  const events = getRecordedEvents();
  if (!events || events.length === 0) return;

  // Prepare document for saving - update the current session, don't create new one
  const endTime = Date.now();

  // Create a copy of the document for saving
  const docToSave = JSON.parse(JSON.stringify(currentDocument));

  // Check if we're updating an existing session or adding a new one
  const existingSessionIndex = docToSave.sessions.findIndex(s => s.id === currentSessionId);

  if (existingSessionIndex >= 0) {
    // Update existing session with latest events and end time
    docToSave.sessions[existingSessionIndex] = {
      id: currentSessionId,
      startTime: new Date(sessionStartTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      baseContent: sessionBaseContent,
      events: events
    };
  } else {
    // First save of this session - add it
    addSession(docToSave, currentSessionId, sessionStartTime, endTime, events, sessionBaseContent);
  }

  await finalizeDocument(docToSave, content);
  docToSave.metadata.title = docTitle.value || 'Untitled';

  // Save to vault
  await saveFileToVault(docToSave, currentFileHandle);

  // Update the current document state (but DON'T start a new session!)
  currentDocument = docToSave;

  // Refresh sidebar to show updated modification time
  refreshSidebar();
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'untitled';
}

/**
 * Handle file selection from sidebar
 *
 * IMPORTANT: Opening a file does NOT immediately start a session. A session
 * only begins when the user makes their first edit. This ensures that simply
 * viewing a file doesn't create empty sessions.
 */
async function handleFileSelectFromSidebar(fileHandle, filename) {
  // Check for unsaved changes
  const events = getRecordedEvents();
  if (events && events.length > 10 && !currentFileHandle) {
    if (!confirm('You have unsaved work. Open a different document anyway?')) {
      return;
    }
  }

  // Cancel any pending rename from previous document
  if (renameDebounceTimer) {
    clearTimeout(renameDebounceTimer);
    renameDebounceTimer = null;
  }

  try {
    const { document: doc } = await openFileFromVault(fileHandle);

    // Set flag to prevent handleEditorChange from triggering auto-create
    isLoadingDocument = true;

    // Set state BEFORE loading content to prevent race conditions
    currentDocument = doc;
    currentFileHandle = fileHandle;
    currentFilename = filename;
    workHasBegun = false; // Session hasn't started yet - will start on first edit
    pendingAutoCreate = false; // Already has a file
    lastRenamedTitle = doc.metadata.title || 'Untitled'; // Track current title to prevent spurious renames

    // Now load content into editor (this triggers handleEditorChange)
    setEditorContent(doc.finalContent || '');
    docTitle.value = doc.metadata.title || '';

    // Clear the loading flag
    isLoadingDocument = false;

    // Prepare for a potential new session (will start on first edit)
    currentSessionId = generateSessionId();
    sessionStartTime = null; // Will be set when work begins
    sessionBaseContent = doc.finalContent || '';

    // Reset recorder but DON'T start session yet - wait for first edit
    recorder.reset();
    recorder.setBaseContent(sessionBaseContent);
    // Note: recorder.startSession() is NOT called here - it will be called
    // in handleEditorChange when the user makes their first edit

    // Reset autosave with new content
    resetAutosave(sessionBaseContent);

    // Update UI
    updatePreview(doc.finalContent || '');
    updateStatusBar();
    highlightActiveFile(filename);
    recordingStatus.textContent = 'Ready';
    recordingStatus.classList.remove('recording');

    console.log('Document opened from sidebar (session will start on first edit)');
  } catch (err) {
    isLoadingDocument = false; // Ensure flag is cleared on error
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
