/**
 * Editor module - Simple textarea-based markdown editor
 *
 * For MVP stability, using a plain textarea with separate preview.
 * WYSIWYG can be added in a future version with a proper library.
 */

let editorElement = null;
let textareaElement = null;
let onChangeCallback = null;
let lastContent = '';

/**
 * Create the editor
 * @param {HTMLElement} container - The container element
 * @param {Object} options - Editor options
 */
export async function createEditor(container, options = {}) {
  editorElement = container;
  onChangeCallback = options.onChange;

  // Create textarea
  textareaElement = document.createElement('textarea');
  textareaElement.className = 'editor-textarea';
  textareaElement.placeholder = 'Start writing in markdown...';
  textareaElement.spellcheck = true;

  // Apply styles
  Object.assign(textareaElement.style, {
    width: '100%',
    height: '100%',
    padding: '1.5rem',
    border: 'none',
    outline: 'none',
    resize: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text-primary)',
    fontFamily: "'SF Mono', 'Fira Code', 'Monaco', monospace",
    fontSize: '14px',
    lineHeight: '1.6'
  });

  container.appendChild(textareaElement);

  // Setup event listeners
  textareaElement.addEventListener('input', handleInput);
  textareaElement.addEventListener('paste', handlePaste);
  textareaElement.addEventListener('keydown', handleKeydown);

  return textareaElement;
}

/**
 * Handle input events
 */
function handleInput(event) {
  const newContent = textareaElement.value;
  const cursorPosition = textareaElement.selectionStart;

  // Notify change callback
  if (onChangeCallback) {
    onChangeCallback(newContent);
  }

  // Dispatch events for recorder - detect insert vs delete
  if (newContent.length > lastContent.length) {
    // Content was added (insert)
    const insertedLength = newContent.length - lastContent.length;
    const insertPosition = cursorPosition - insertedLength;
    const insertedContent = newContent.substring(insertPosition, cursorPosition);

    // Don't record paste events here - handled separately
    if (event.inputType !== 'insertFromPaste') {
      const customEvent = new CustomEvent('editor-input', {
        detail: {
          inputType: event.inputType || 'insertText',
          data: insertedContent,
          value: newContent,
          selectionStart: cursorPosition,
          selectionEnd: cursorPosition
        }
      });
      document.dispatchEvent(customEvent);
    }
  } else if (newContent.length < lastContent.length) {
    // Content was removed (delete)
    const deletedLength = lastContent.length - newContent.length;
    const deletePosition = cursorPosition;
    const deletedContent = lastContent.substring(deletePosition, deletePosition + deletedLength);

    const customEvent = new CustomEvent('editor-input', {
      detail: {
        inputType: event.inputType || 'deleteContentBackward',
        data: deletedContent,
        value: newContent,
        selectionStart: cursorPosition,
        selectionEnd: cursorPosition
      }
    });
    document.dispatchEvent(customEvent);
  }

  lastContent = newContent;
}

/**
 * Handle paste events
 */
function handlePaste(event) {
  const pastedText = event.clipboardData.getData('text');
  const position = textareaElement.selectionStart;

  // Dispatch custom event for recorder
  const customEvent = new CustomEvent('editor-paste', {
    detail: {
      content: pastedText,
      position: position
    }
  });
  document.dispatchEvent(customEvent);

  // Let the default paste happen, then update lastContent
  setTimeout(() => {
    lastContent = textareaElement.value;
  }, 0);
}

/**
 * Handle keydown for special keys
 */
function handleKeydown(event) {
  // Handle Tab for indentation
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = textareaElement.selectionStart;
    const end = textareaElement.selectionEnd;
    const value = textareaElement.value;

    textareaElement.value = value.substring(0, start) + '  ' + value.substring(end);
    textareaElement.selectionStart = textareaElement.selectionEnd = start + 2;

    // Trigger input event
    textareaElement.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * Get current editor content
 */
export function getEditorContent() {
  return textareaElement ? textareaElement.value : '';
}

/**
 * Set editor content
 */
export function setEditorContent(content) {
  if (textareaElement) {
    textareaElement.value = content;
    lastContent = content;
    if (onChangeCallback) {
      onChangeCallback(content);
    }
  }
}

/**
 * Focus the editor
 */
export function focusEditor() {
  if (textareaElement) {
    textareaElement.focus();
  }
}

/**
 * Get cursor position
 */
export function getCursorPosition() {
  if (!textareaElement) return 0;
  return textareaElement.selectionStart;
}
