/**
 * Editor module - CodeMirror 6 markdown editor with in-place rendering
 *
 * Provides a single-pane editor with cursor-aware rendering for
 * headers and lists. Maintains the same API as the previous textarea editor.
 */

import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { inPlaceRenderPlugin } from './cmDecorations.js';

let editorView = null;
let onChangeCallback = null;
let lastContent = '';
let suppressEvents = false;

/**
 * Dark theme matching existing Provenance CSS variables
 */
const provenanceTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--bg-primary)'
  },
  '.cm-scroller': {
    fontFamily: "'SF Mono', 'Fira Code', 'Monaco', monospace",
    fontSize: '14px',
    lineHeight: '1.6',
    padding: '1.5rem',
    overflow: 'auto'
  },
  '.cm-content': {
    color: 'var(--text-primary)',
    caretColor: 'var(--accent)'
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--accent)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(78, 204, 163, 0.3) !important'
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(255, 255, 255, 0.03)'
  }
}, { dark: true });


/**
 * Create the editor
 * @param {HTMLElement} container - The container element
 * @param {Object} options - Editor options
 */
export async function createEditor(container, options = {}) {
  onChangeCallback = options.onChange;

  const startState = EditorState.create({
    doc: '',
    extensions: [
      history(),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab
      ]),
      markdown(),
      provenanceTheme,
      inPlaceRenderPlugin,
      placeholder('CONTENT'),
      EditorView.lineWrapping,
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          handleDocChange(update);
        }
      }),
      EditorView.domEventHandlers({
        paste(event, view) {
          handlePaste(event, view);
          return false; // let CM6 handle the actual paste
        }
      })
    ]
  });

  editorView = new EditorView({
    state: startState,
    parent: container
  });

  return editorView;
}

/**
 * Handle document changes — dispatch events for recorder
 *
 * Uses CM6's change iteration to detect individual inserts and deletes,
 * preserving the same event contract as the textarea implementation.
 */
function handleDocChange(update) {
  if (suppressEvents) return;

  const newContent = update.state.doc.toString();

  // Notify the onChange callback (for app.js session lifecycle, autosave, etc.)
  if (onChangeCallback) {
    onChangeCallback(newContent);
  }

  // Check if this transaction is a paste — if so, skip editor-input dispatch
  // (paste is handled separately via domEventHandlers)
  const isPaste = update.transactions.some(tr =>
    tr.isUserEvent('input.paste')
  );

  if (!isPaste) {
    // Dispatch editor-input events for each change span
    update.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      const insertedText = inserted.toString();
      const deletedLength = toA - fromA;

      // Handle deletions
      if (deletedLength > 0) {
        const deletedText = lastContent.substring(fromA, toA);
        document.dispatchEvent(new CustomEvent('editor-input', {
          detail: {
            inputType: 'deleteContentBackward',
            data: deletedText,
            value: newContent,
            selectionStart: fromA,
            selectionEnd: fromA
          }
        }));
      }

      // Handle insertions
      if (insertedText.length > 0) {
        document.dispatchEvent(new CustomEvent('editor-input', {
          detail: {
            inputType: 'insertText',
            data: insertedText,
            value: newContent,
            selectionStart: fromB + insertedText.length,
            selectionEnd: fromB + insertedText.length
          }
        }));
      }
    });
  }

  lastContent = newContent;
}

/**
 * Handle paste events — dispatch editor-paste for recorder
 *
 * Fires before CM6 processes the paste, capturing the clipboard text
 * and the current cursor position.
 */
function handlePaste(event, view) {
  const pastedText = event.clipboardData.getData('text');
  const position = view.state.selection.main.from;

  document.dispatchEvent(new CustomEvent('editor-paste', {
    detail: {
      content: pastedText,
      position: position
    }
  }));
}

/**
 * Get current editor content
 */
export function getEditorContent() {
  return editorView ? editorView.state.doc.toString() : '';
}

/**
 * Set editor content programmatically
 *
 * Uses suppressEvents flag to prevent recorder events from firing.
 * CM6's dispatch is synchronous, so the flag is safe to use inline.
 */
export function setEditorContent(content) {
  if (editorView) {
    suppressEvents = true;
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: content
      }
    });
    suppressEvents = false;
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
  if (editorView) {
    editorView.focus();
  }
}

/**
 * Get cursor position
 */
export function getCursorPosition() {
  if (!editorView) return 0;
  return editorView.state.selection.main.head;
}
