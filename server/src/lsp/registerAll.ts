import { Connection, TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { registerCompletion } from './handlers/completion';
import { registerDefinition } from './handlers/definition';
import { registerHover } from './handlers/hover';
import { registerReferences } from './handlers/references';
import { registerRename } from './handlers/rename';
import { registerWorkspaceSymbol } from './handlers/workspaceSymbol';
import { registerDiagnostics } from './handlers/diagnostics';

export function registerAllHandlers(conn: Connection, docs: TextDocuments<TextDocument>): void {
  registerCompletion(conn, docs);
  registerDefinition(conn, docs);
  registerHover(conn, docs);
  registerReferences(conn, docs);
  registerRename(conn, docs);
  registerWorkspaceSymbol(conn, docs);
  registerDiagnostics(conn, docs);
}
