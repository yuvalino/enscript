import { Position, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

// Small helper utilities around TextDocument until we adopt LSP 3.18 text-sync.
export function positionAtOffset(doc: TextDocument, offset: number): Position {
  return doc.positionAt(offset);
}

export function rangeFromOffsets(doc: TextDocument, start: number, end: number): Range {
  return { start: doc.positionAt(start), end: doc.positionAt(end) };
}
