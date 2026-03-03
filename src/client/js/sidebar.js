/**
 * Sidebar module - File list and navigation UI
 *
 * Manages the collapsible sidebar that displays vault files
 * and handles file selection for editing.
 */

import { listVaultFiles, isVaultReady, showVaultPicker, requestPermission, getStoredHandle } from './vault.js';

// Sidebar state
let isCollapsed = false;
let currentFilename = null;
let currentMode = 'editor';
let onFileSelectCallback = null;
let onFileSelectForViewerCallback = null;
let onFileDeleteCallback = null;
let cachedFiles = []; // Cache files for re-rendering with different handlers

// DOM elements
let sidebar = null;
let sidebarToggle = null;
let fileList = null;
let fileListContainer = null;
let vaultSetup = null;
let sidebarLoading = null;
let sidebarError = null;
let btnSelectVault = null;
let btnChangeVault = null;

/**
 * Initialize the sidebar
 * @param {Object} options
 * @param {Function} options.onFileSelect - Callback when file is selected for editing
 * @param {Function} options.onFileSelectForViewer - Callback when file is selected for viewing
 * @param {Function} options.onFileDelete - Callback when file is deleted
 */
export function initSidebar(options = {}) {
  onFileSelectCallback = options.onFileSelect;
  onFileSelectForViewerCallback = options.onFileSelectForViewer;
  onFileDeleteCallback = options.onFileDelete;

  // Get DOM elements
  sidebar = document.getElementById('sidebar');
  sidebarToggle = document.getElementById('sidebar-toggle');
  fileList = document.getElementById('file-list');
  fileListContainer = document.getElementById('file-list-container');
  vaultSetup = document.getElementById('vault-setup');
  sidebarLoading = document.getElementById('sidebar-loading');
  sidebarError = document.getElementById('sidebar-error');
  btnSelectVault = document.getElementById('btn-select-vault');
  btnChangeVault = document.getElementById('btn-change-vault');

  // Setup event listeners
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', toggleSidebar);
  }

  if (btnSelectVault) {
    btnSelectVault.addEventListener('click', handleVaultSetup);
  }

  if (btnChangeVault) {
    btnChangeVault.addEventListener('click', handleVaultSetup);
  }

  // Single delegated listener for all file-list interactions
  if (fileList) {
    fileList.addEventListener('click', handleFileListClick);
  }

  // Load initial state from localStorage
  const savedCollapsed = localStorage.getItem('provenance-sidebar-collapsed');
  if (savedCollapsed === 'true') {
    isCollapsed = true;
    sidebar?.classList.add('collapsed');
  }

  console.log('Sidebar initialized');
}

/**
 * Delegated click handler for the entire file list.
 * Using delegation avoids re-attaching listeners on every render.
 */
function handleFileListClick(e) {
  const btn = e.target.closest('.file-delete-btn');
  if (btn) {
    e.stopPropagation();
    const filename = btn.dataset.filename;
    const file = cachedFiles.find(f => f.name === filename);
    if (file && onFileDeleteCallback) {
      onFileDeleteCallback(file.handle, file.name);
    }
    return;
  }

  const item = e.target.closest('.file-item');
  if (item) {
    const filename = item.dataset.filename;
    const file = cachedFiles.find(f => f.name === filename);
    if (file) {
      if (currentMode === 'viewer' && onFileSelectForViewerCallback) {
        onFileSelectForViewerCallback(file.handle, file.name);
      } else if (onFileSelectCallback) {
        onFileSelectCallback(file.handle, file.name);
      }
    }
  }
}

/**
 * Update sidebar to show appropriate state
 * @param {boolean} vaultReady - Whether vault is configured and accessible
 */
export function updateSidebarState(vaultReady) {
  if (!sidebar) return;

  if (vaultReady) {
    vaultSetup?.classList.add('hidden');
    fileListContainer?.classList.remove('hidden');
    btnChangeVault?.classList.remove('hidden');
    refreshSidebar();
  } else {
    vaultSetup?.classList.remove('hidden');
    fileListContainer?.classList.add('hidden');
    // Show vault setup prompt
  }
}

/**
 * Toggle sidebar expanded/collapsed state
 */
export function toggleSidebar() {
  isCollapsed = !isCollapsed;
  sidebar?.classList.toggle('collapsed', isCollapsed);

  // Save state to localStorage
  localStorage.setItem('provenance-sidebar-collapsed', isCollapsed.toString());
}

/**
 * Expand the sidebar
 */
export function expandSidebar() {
  isCollapsed = false;
  sidebar?.classList.remove('collapsed');
  localStorage.setItem('provenance-sidebar-collapsed', 'false');
}

/**
 * Collapse the sidebar
 */
export function collapseSidebar() {
  isCollapsed = true;
  sidebar?.classList.add('collapsed');
  localStorage.setItem('provenance-sidebar-collapsed', 'true');
}

/**
 * Handle vault setup/change button click
 */
async function handleVaultSetup() {
  try {
    // IMPORTANT: Call showVaultPicker() FIRST, before any async operations or UI updates
    // The File System Access API requires the picker to be called synchronously
    // within the user gesture (click) event handler. Any await or DOM manipulation
    // before this call can break the user gesture chain.
    const handle = await showVaultPicker();

    if (handle) {
      showLoading();
      await refreshSidebar();
      updateSidebarState(true);
      hideLoading();
    } else {
      // User cancelled
      if (!isVaultReady()) {
        updateSidebarState(false);
      }
    }
  } catch (err) {
    hideLoading();
    showError('Failed to select vault folder: ' + err.message);
  }
}

/**
 * Refresh the file list from vault.
 * On routine refreshes (list already populated) skips the loading state
 * entirely so the sidebar never blinks in and out.
 */
export async function refreshSidebar() {
  if (!isVaultReady()) {
    // Try to request permission for stored handle
    const storedHandle = getStoredHandle();
    if (storedHandle) {
      const hasPermission = await requestPermission(storedHandle);
      if (!hasPermission) {
        updateSidebarState(false);
        return;
      }
    } else {
      updateSidebarState(false);
      return;
    }
  }

  // Only show the loading spinner on the very first load when no items exist yet.
  // Subsequent autosave-triggered refreshes patch the DOM in-place without hiding anything.
  const hasExistingItems = fileList && fileList.querySelector('.file-item') !== null;

  try {
    if (!hasExistingItems) {
      showLoading();
    }
    const files = await listVaultFiles();
    renderFileList(files);
    hideLoading();
    fileListContainer?.classList.remove('hidden');
    vaultSetup?.classList.add('hidden');
  } catch (err) {
    console.error('Error refreshing sidebar:', err);
    showError('Failed to load files: ' + err.message);
  }
}

/**
 * Render (or patch) the file list in the sidebar.
 * Uses a diffed DOM update strategy: existing items are updated in-place,
 * new items are inserted, and removed items are deleted — without touching
 * the rest of the list. This eliminates the blink caused by full innerHTML
 * replacement on every autosave.
 *
 * @param {Array} files - Array of file info objects
 * @param {string} mode - 'editor' or 'viewer' mode
 */
export function renderFileList(files, mode = currentMode) {
  if (!fileList) return;

  cachedFiles = files;
  currentMode = mode;

  if (files.length === 0) {
    fileList.innerHTML = `
      <li class="file-list-empty">
        <p>No documents yet</p>
        <p class="hint">Start writing to create your first document</p>
      </li>
    `;
    return;
  }

  // Remove empty-state placeholder if present
  const emptyItem = fileList.querySelector('.file-list-empty');
  if (emptyItem) emptyItem.remove();

  // Index existing items by filename for O(1) lookup
  const existingItems = new Map();
  fileList.querySelectorAll('.file-item[data-filename]').forEach(item => {
    existingItems.set(item.dataset.filename, item);
  });

  // Remove items that are no longer in the file list
  const newFilenames = new Set(files.map(f => f.name));
  existingItems.forEach((item, filename) => {
    if (!newFilenames.has(filename)) {
      item.remove();
    }
  });

  // Update existing items in-place or create new ones, then enforce order
  files.forEach((file, index) => {
    const isActive = file.name === currentFilename;
    let item = existingItems.get(file.name);

    if (item) {
      // Patch only what changed — avoid touching the DOM if nothing is different
      item.classList.toggle('active', isActive);

      const titleEl = item.querySelector('.file-title');
      const dateEl = item.querySelector('.file-date');
      const newDate = formatDate(file.lastModified);

      if (titleEl && titleEl.textContent !== file.title) {
        titleEl.textContent = file.title;
      }
      if (dateEl && dateEl.textContent !== newDate) {
        dateEl.textContent = newDate;
      }
    } else {
      // Create a fresh item (event listeners are handled by delegation)
      item = createFileItem(file, isActive);
    }

    // Maintain sort order without moving items that are already in the right position
    const nodeAtIndex = fileList.children[index];
    if (nodeAtIndex !== item) {
      fileList.insertBefore(item, nodeAtIndex || null);
    }
  });
}

/**
 * Create a new file list item element.
 * Does NOT attach any event listeners — the delegated listener on fileList handles all clicks.
 */
function createFileItem(file, isActive) {
  const li = document.createElement('li');
  li.className = `file-item${isActive ? ' active' : ''}`;
  li.dataset.filename = file.name;
  li.innerHTML = `
    <div class="file-icon">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zm5.5 0v3a1.5 1.5 0 0 0 1.5 1.5h3"/>
      </svg>
    </div>
    <div class="file-info">
      <span class="file-title">${escapeHtml(file.title)}</span>
      <span class="file-date">${formatDate(file.lastModified)}</span>
    </div>
    <button class="file-delete-btn" title="Delete document" data-filename="${escapeHtml(file.name)}">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
      </svg>
    </button>
  `;
  return li;
}

/**
 * Update file list click handlers for a different mode
 * @param {string} mode - 'editor' or 'viewer'
 */
export function setFileListMode(mode) {
  currentMode = mode;
  // Re-render to apply active-state and order — fully in-place, no flash
  if (cachedFiles.length > 0) {
    renderFileList(cachedFiles, mode);
  }
}

/**
 * Highlight the currently active file
 * @param {string} filename
 */
export function highlightActiveFile(filename) {
  currentFilename = filename;

  if (!fileList) return;

  fileList.querySelectorAll('.file-item').forEach(item => {
    item.classList.toggle('active', item.dataset.filename === filename);
  });
}

/**
 * Clear active file highlight (for new documents)
 */
export function clearActiveFile() {
  currentFilename = null;

  if (!fileList) return;

  fileList.querySelectorAll('.file-item').forEach(item => {
    item.classList.remove('active');
  });
}

/**
 * Show loading state in sidebar
 */
function showLoading() {
  sidebarLoading?.classList.remove('hidden');
  sidebarError?.classList.add('hidden');
  fileListContainer?.classList.add('hidden');
}

/**
 * Hide loading state
 */
function hideLoading() {
  sidebarLoading?.classList.add('hidden');
}

/**
 * Show error state in sidebar
 * @param {string} message
 */
function showError(message) {
  hideLoading();
  sidebarError?.classList.remove('hidden');
  fileListContainer?.classList.add('hidden');

  const errorMessage = document.getElementById('sidebar-error-message');
  if (errorMessage) {
    errorMessage.textContent = message;
  }
}

/**
 * Format date for display
 * @param {Date|null} date
 */
function formatDate(date) {
  if (!date) return 'Unknown date';

  const now = new Date();
  const diff = now - date;

  // Less than 24 hours
  if (diff < 86400000) {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  // Less than 7 days
  if (diff < 604800000) {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  // Older
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: now.getFullYear() !== date.getFullYear() ? 'numeric' : undefined
  });
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Check if sidebar is collapsed
 */
export function isSidebarCollapsed() {
  return isCollapsed;
}
