import {
    createConnection,
    TextDocuments,
    TextDocumentSyncKind,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    ConfigurationItem
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { registerAllHandlers } from './lsp/registerAll';
import * as url from 'node:url';
import * as fs from 'fs/promises';
import { findAllFiles, readFileUtf8 } from './util/fs';
import { Analyzer } from './analysis/project/graph';
import { getConfiguration } from './util/config';


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
    const config = await getConfiguration(connection);
    const includePaths = config.includePaths as string[] || [];

    const pathsToIndex = [workspaceRoot, ...includePaths];
    const allFiles: string[] = [];

    for (const basePath of pathsToIndex) {
        console.log(`Adding folder ${basePath} to indexing`);
        try {
            const files = await findAllFiles(basePath, ['.c']);
            allFiles.push(...files);
        } catch (err) {
            console.warn(`Failed to scan path: ${basePath} – ${String(err)}`);
        }
    }

    console.log(`Indexing ${allFiles.length} EnScript files...`);

    for (const filePath of allFiles) {
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
