import {
  Connection,
  PrepareRenameParams,
  Range,
  RenameParams,
  TextEdit,
  WorkspaceEdit,
  TextDocuments
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';

export function registerRename(conn: Connection, docs: TextDocuments<TextDocument>): void {
  const analyser = Analyzer.instance();

  conn.onPrepareRename((params: PrepareRenameParams): Range | null => {
    const doc = docs.get(params.textDocument.uri);
    if (!doc) return null;
    return analyser.prepareRename(doc, params.position);
  });

  conn.onRenameRequest((params: RenameParams): WorkspaceEdit => {
    const doc = docs.get(params.textDocument.uri);
    if (!doc) return { changes: {} };

    const edits = analyser.renameSymbol(doc, params.position, params.newName);
    const workspaceChanges: Record<string, TextEdit[]> = {};
    for (const e of edits) {
      if (!workspaceChanges[e.uri]) workspaceChanges[e.uri] = [];
      workspaceChanges[e.uri].push({ range: e.range, newText: params.newName });
    }
    return { changes: workspaceChanges };
  });
}
