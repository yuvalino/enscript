import {
  createConnection,
  TextDocuments,
  TextDocumentSyncKind,
  ProposedFeatures,
  InitializeParams,
  InitializeResult
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { registerAllHandlers } from './lsp/registerAll';

// Create LSP connection (stdio or Node IPC autodetect).
const connection = createConnection(ProposedFeatures.all);

// Track open documents — in-memory mirror of the client.
export const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: { resolveProvider: false, triggerCharacters: ['.', '>', ':'] },
      definitionProvider: true,
      hoverProvider: true,
      referencesProvider: true,
      renameProvider: true,
      workspaceSymbolProvider: true
    }
  };
});

// Wire all feature handlers.
registerAllHandlers(connection, documents);

documents.listen(connection);

// Start listening after the handlers were registered.
connection.listen();
