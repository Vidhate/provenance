/**
 * Vault module - File System Access API wrapper
 *
 * Handles vault directory selection, persistence, and file operations
 * using the modern File System Access API (Chrome/Edge only).
 */

const DB_NAME = 'provenance-vault';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const VAULT_HANDLE_KEY = 'vaultDirectoryHandle';

// Vault state
let directoryHandle = null;
let isVaultConfigured = false;

/**
 * Check if File System Access API is supported
 */
export function isFileSystemAccessSupported() {
  return 'showDirectoryPicker' in window &&
         'FileSystemDirectoryHandle' in window;
}

/**
 * Initialize the vault system
 * Attempts to load and verify a previously stored vault handle
 * @returns {Promise<boolean>} - Whether vault is ready to use
 */
export async function initVault() {
  if (!isFileSystemAccessSupported()) {
    console.log('File System Access API not supported');
    return false;
  }

  try {
    const storedHandle = await loadPersistedVaultHandle();

    if (storedHandle) {
      // Try to get permission for the stored handle
      const hasPermission = await requestPermission(storedHandle);

      if (hasPermission) {
        directoryHandle = storedHandle;
        isVaultConfigured = true;
        console.log('Vault restored from previous session');
        return true;
      } else {
        console.log('Permission denied for stored vault handle');
        // Don't clear the handle - user might grant permission later
        directoryHandle = storedHandle;
        return false;
      }
    }
  } catch (err) {
    console.error('Error initializing vault:', err);
  }

  return false;
}

/**
 * Show the directory picker for vault selection
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function showVaultPicker() {
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents'
    });

    directoryHandle = handle;
    isVaultConfigured = true;

    // Persist the handle
    await persistVaultHandle(handle);

    console.log('Vault selected:', handle.name);
    return handle;
  } catch (err) {
    if (err.name === 'AbortError') {
      // User cancelled - not an error
      console.log('Vault selection cancelled');
      return null;
    }
    console.error('Error selecting vault:', err);
    throw err;
  }
}

/**
 * Request permission for a file/directory handle
 * @param {FileSystemHandle} handle
 * @returns {Promise<boolean>}
 */
export async function requestPermission(handle) {
  try {
    // Check current permission
    const permission = await handle.queryPermission({ mode: 'readwrite' });

    if (permission === 'granted') {
      return true;
    }

    // Request permission
    const result = await handle.requestPermission({ mode: 'readwrite' });
    return result === 'granted';
  } catch (err) {
    console.error('Error requesting permission:', err);
    return false;
  }
}

/**
 * Open IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

/**
 * Persist vault handle to IndexedDB
 * @param {FileSystemDirectoryHandle} handle
 */
export async function persistVaultHandle(handle) {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const request = store.put(handle, VAULT_HANDLE_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        resolve();
      };
    });
  } catch (err) {
    console.error('Error persisting vault handle:', err);
    throw err;
  }
}

/**
 * Load persisted vault handle from IndexedDB
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
export async function loadPersistedVaultHandle() {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      const request = store.get(VAULT_HANDLE_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        resolve(request.result || null);
      };
    });
  } catch (err) {
    console.error('Error loading vault handle:', err);
    return null;
  }
}

/**
 * Clear vault configuration
 */
export async function clearVaultConfig() {
  try {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const request = store.delete(VAULT_HANDLE_KEY);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db.close();
        directoryHandle = null;
        isVaultConfigured = false;
        resolve();
      };
    });
  } catch (err) {
    console.error('Error clearing vault config:', err);
    throw err;
  }
}

/**
 * List all .provenance files in the vault
 * @returns {Promise<Array<{name: string, handle: FileSystemFileHandle, title: string, lastModified: Date}>>}
 */
export async function listVaultFiles() {
  if (!directoryHandle) {
    return [];
  }

  const files = [];

  try {
    for await (const entry of directoryHandle.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.provenance')) {
        try {
          const metadata = await getFileMetadata(entry);
          files.push({
            name: entry.name,
            handle: entry,
            title: metadata.title,
            lastModified: metadata.lastModified
          });
        } catch (err) {
          // If we can't read the file, still show it with fallback title
          files.push({
            name: entry.name,
            handle: entry,
            title: entry.name.replace('.provenance', ''),
            lastModified: null
          });
        }
      }
    }

    // Sort by last modified (most recent first)
    files.sort((a, b) => {
      if (!a.lastModified) return 1;
      if (!b.lastModified) return -1;
      return b.lastModified - a.lastModified;
    });

    return files;
  } catch (err) {
    console.error('Error listing vault files:', err);
    throw err;
  }
}

/**
 * Get metadata from a .provenance file
 * @param {FileSystemFileHandle} fileHandle
 * @returns {Promise<{title: string, lastModified: Date}>}
 */
export async function getFileMetadata(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  const doc = JSON.parse(text);

  return {
    title: doc.metadata?.title || fileHandle.name.replace('.provenance', ''),
    lastModified: new Date(doc.metadata?.lastModifiedAt || file.lastModified)
  };
}

/**
 * Open a file from the vault for editing
 * @param {FileSystemFileHandle} fileHandle
 * @returns {Promise<{document: Object, handle: FileSystemFileHandle}>}
 */
export async function openFileFromVault(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  const document = JSON.parse(text);

  return {
    document,
    handle: fileHandle
  };
}

/**
 * Save a document to an existing file in the vault
 * @param {Object} document - The provenance document
 * @param {FileSystemFileHandle} fileHandle
 */
export async function saveFileToVault(document, fileHandle) {
  const json = JSON.stringify(document, null, 2);

  // Use keepExistingData: false to avoid creating .crswap temp files
  // This writes directly to the file instead of using a swap file
  const writable = await fileHandle.createWritable({ keepExistingData: false });
  await writable.write(json);
  await writable.close();
}

/**
 * Create a new file in the vault
 * @param {Object} document - The provenance document
 * @param {string} filename - The filename (without extension)
 * @returns {Promise<FileSystemFileHandle>}
 */
export async function createNewFileInVault(document, filename) {
  if (!directoryHandle) {
    throw new Error('Vault not configured');
  }

  // Sanitize filename and ensure .provenance extension
  const sanitizedName = filename.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'untitled';
  const fullFilename = `${sanitizedName}.provenance`;

  // Check if file already exists and create unique name if needed
  let finalFilename = fullFilename;
  let counter = 1;

  while (true) {
    try {
      await directoryHandle.getFileHandle(finalFilename);
      // File exists, try a new name
      finalFilename = `${sanitizedName}_${counter}.provenance`;
      counter++;
    } catch {
      // File doesn't exist, we can use this name
      break;
    }
  }

  const fileHandle = await directoryHandle.getFileHandle(finalFilename, { create: true });
  await saveFileToVault(document, fileHandle);

  return fileHandle;
}

/**
 * Rename a file in the vault
 * Note: File System Access API doesn't support direct rename, so we copy and delete
 * @param {FileSystemFileHandle} oldHandle - The current file handle
 * @param {string} newTitle - The new title (without extension)
 * @returns {Promise<FileSystemFileHandle|null>} - New file handle or null if no change needed
 */
export async function renameFileInVault(oldHandle, newTitle) {
  if (!directoryHandle) {
    throw new Error('Vault not configured');
  }

  // Sanitize new filename
  const sanitizedName = newTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'untitled';
  const newFilename = `${sanitizedName}.provenance`;

  // Check if filename is the same (no rename needed)
  if (oldHandle.name === newFilename) {
    return null;
  }

  // Check if new filename already exists
  let finalFilename = newFilename;
  let counter = 1;

  while (true) {
    try {
      const existingHandle = await directoryHandle.getFileHandle(finalFilename);
      // File exists - check if it's the same file
      if (existingHandle.name === oldHandle.name) {
        break;
      }
      // Different file exists, try a new name
      finalFilename = `${sanitizedName}_${counter}.provenance`;
      counter++;
    } catch {
      // File doesn't exist, we can use this name
      break;
    }
  }

  // Read old file content
  const oldFile = await oldHandle.getFile();
  const content = await oldFile.text();

  // Create new file with new name
  const newHandle = await directoryHandle.getFileHandle(finalFilename, { create: true });
  // Use keepExistingData: false to avoid creating .crswap temp files
  const writable = await newHandle.createWritable({ keepExistingData: false });
  await writable.write(content);
  await writable.close();

  // Delete old file
  try {
    await directoryHandle.removeEntry(oldHandle.name);
  } catch (err) {
    console.error('Error removing old file:', err);
    // Continue anyway - the new file was created
  }

  return newHandle;
}

/**
 * Delete a file from the vault
 * @param {FileSystemFileHandle} fileHandle - The file to delete
 */
export async function deleteFileFromVault(fileHandle) {
  if (!directoryHandle) {
    throw new Error('Vault not configured');
  }

  await directoryHandle.removeEntry(fileHandle.name);
}

/**
 * Check if vault is configured and ready
 */
export function isVaultReady() {
  return isVaultConfigured && directoryHandle !== null;
}

/**
 * Get the vault directory handle
 */
export function getVaultHandle() {
  return directoryHandle;
}

/**
 * Get the stored handle (even if permission not granted)
 * Useful for re-requesting permission
 */
export function getStoredHandle() {
  return directoryHandle;
}
