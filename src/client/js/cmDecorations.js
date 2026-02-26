/**
 * CodeMirror 6 Decorations for In-Place Markdown Rendering
 *
 * Provides cursor-aware rendering for headers (h1-h6) and lists (bullet + ordered).
 * When the cursor is on a line, raw markdown syntax is shown.
 * When the cursor leaves, the line is rendered with styled formatting.
 */

import { Decoration, ViewPlugin } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';

/**
 * Line-level decorations for heading sizes
 */
const headingLineDecos = {
  1: Decoration.line({ class: 'cm-heading-1' }),
  2: Decoration.line({ class: 'cm-heading-2' }),
  3: Decoration.line({ class: 'cm-heading-3' }),
  4: Decoration.line({ class: 'cm-heading-4' }),
  5: Decoration.line({ class: 'cm-heading-5' }),
  6: Decoration.line({ class: 'cm-heading-6' })
};

const listBulletLineDeco = Decoration.line({ class: 'cm-list-bullet' });
const listOrderedLineDeco = Decoration.line({ class: 'cm-list-ordered' });

/**
 * Get the set of line numbers where the cursor (or selection) is located
 */
function getCursorLines(state) {
  const lines = new Set();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let n = startLine; n <= endLine; n++) {
      lines.add(n);
    }
  }
  return lines;
}

/**
 * Build decorations by walking the Lezer syntax tree
 */
function buildDecorations(view) {
  const { state } = view;
  const cursorLines = getCursorLines(state);
  const builder = [];

  syntaxTree(state).iterate({
    enter(node) {
      // ATX Headings: ATXHeading1 through ATXHeading6
      const headingMatch = node.name.match(/^ATXHeading(\d)$/);
      if (headingMatch) {
        const level = parseInt(headingMatch[1]);
        const line = state.doc.lineAt(node.from);

        if (cursorLines.has(line.number)) return;

        // Find the HeaderMark child (the # characters)
        let headerMarkEnd = -1;
        const cursor = node.node.cursor();
        if (cursor.firstChild()) {
          do {
            if (cursor.name === 'HeaderMark') {
              // HeaderMark covers the # chars; we also want to hide the trailing space
              headerMarkEnd = cursor.to;
              break;
            }
          } while (cursor.nextSibling());
        }

        // Apply line-level heading style
        builder.push(headingLineDecos[level].range(line.from));

        // Hide the # markers + trailing space
        if (headerMarkEnd > 0) {
          const hideEnd = Math.min(headerMarkEnd + 1, line.to); // +1 for the space after #
          if (hideEnd > line.from) {
            builder.push(Decoration.replace({}).range(line.from, hideEnd));
          }
        }

        return false; // don't descend into heading children
      }

      // List items
      if (node.name === 'ListItem') {
        const line = state.doc.lineAt(node.from);

        if (cursorLines.has(line.number)) return;

        const lineText = state.doc.sliceString(line.from, line.to);

        // Bullet list: starts with optional whitespace then - * +
        const bulletMatch = lineText.match(/^(\s*)([-*+])\s/);
        if (bulletMatch) {
          const markerStart = line.from + bulletMatch[1].length;
          const markerEnd = markerStart + bulletMatch[2].length + 1; // marker + space
          builder.push(listBulletLineDeco.range(line.from));
          builder.push(Decoration.replace({}).range(markerStart, markerEnd));
          return false;
        }

        // Ordered list: starts with optional whitespace then number + dot + space
        const orderedMatch = lineText.match(/^(\s*)(\d+)\.\s/);
        if (orderedMatch) {
          const markerStart = line.from + orderedMatch[1].length;
          const markerEnd = markerStart + orderedMatch[0].length - orderedMatch[1].length;
          builder.push(listOrderedLineDeco.range(line.from));
          builder.push(Decoration.replace({}).range(markerStart, markerEnd));
          return false;
        }
      }
    }
  });

  // Sort by position (required by RangeSet)
  builder.sort((a, b) => a.from - b.from || a.startSide - b.startSide);

  return Decoration.set(builder);
}

/**
 * ViewPlugin that manages cursor-aware decorations for headers and lists.
 * Rebuilds on document changes and selection changes.
 */
export const inPlaceRenderPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: v => v.decorations
  }
);
