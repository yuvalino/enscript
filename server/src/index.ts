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
import * as url from 'node:url';
import * as fs from 'fs/promises';
import { findAllFiles, readFileUtf8 } from './util/fs';
import { Analyzer } from './analysis/project/graph';


// Create LSP connection (stdio or Node IPC autodetect).
const connection = createConnection(ProposedFeatures.all);

// Track open documents — in-memory mirror of the client.
export const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceRoot = '';

connection.onInitialize((_params: InitializeParams): InitializeResult => {
    const folders = _params.workspaceFolders ?? [];
    if (folders.length > 0) {
        workspaceRoot = url.fileURLToPath(folders[0].uri);
    } else if (_params.rootUri) {
        workspaceRoot = url.fileURLToPath(_params.rootUri);
    }

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

connection.onInitialized(async () => {
    const files = await findAllFiles(workspaceRoot, ['.c']);
    console.log(`Indexing ${files.length} EnScript files...`);

    for (const filePath of files) {
        const uri = url.pathToFileURL(filePath).toString();
        const text = await readFileUtf8(filePath);
        const doc = TextDocument.create(uri, 'enscript', 1, text);

        Analyzer.instance().runDiagnostics(doc);  // will parse & cache
    }

    console.log('Indexing complete.');
});

// Wire all feature handlers.
registerAllHandlers(connection, documents);

documents.listen(connection);

// Start listening after the handlers were registered.
connection.listen();
