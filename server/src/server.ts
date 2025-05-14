import * as fs from 'fs';
import * as path from 'path';
import {
    fileURLToPath,
    pathToFileURL
} from 'url';                                   // ← built-in alternative
import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    InitializeParams,
    InitializeResult,
    Location,
    Position,
    Range,
    TextDocumentSyncKind,
    WorkspaceFolder,
    SymbolInformation,
    SymbolKind
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { parseSymbols } from './parser';

/* ░░ GLOBAL STATE ░░ */
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Map<symbol, Location[]> – all definitions, first entry is “canonical”
const symbolTable: Map<string, Location[]> = new Map();

// Map<uri, Set<symbol>> – allows fast removal when a file changes
const reverseIndex: Map<string, Set<string>> = new Map();

/* ░░ INITIALISE ░░ */
connection.onInitialize(
    (_params: InitializeParams): InitializeResult => ({
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            definitionProvider: true,
            workspaceSymbolProvider: true
        }
    })
);

connection.onInitialized(async () => {
    const folders = await connection.workspace.getWorkspaceFolders();
    if (folders) {
        for (const folder of folders) {
            await indexWorkspaceFolder(folder);
        }
    }
});

/* ░░ DOCUMENT-LEVEL EVENTS ░░ */
documents.onDidOpen(e => indexDocument(e.document));
documents.onDidChangeContent(e => indexDocument(e.document));
documents.onDidClose(e => purgeDocument(e.document.uri));

/* ░░ LANGUAGE FEATURES ░░ */
connection.onDefinition(({ textDocument, position }) => {
    const word = getWordAtPosition(textDocument.uri, position);
    const locs = symbolTable.get(word);
    return locs ? locs[0] : null;
});

connection.onWorkspaceSymbol(({ query }) => {
    const out: SymbolInformation[] = [];
    for (const [sym, locs] of symbolTable) {
        if (sym.includes(query)) {
            out.push({
                name: sym,
                kind: SymbolKind.Variable,      // adjust when you refine parsing
                location: locs[0]
            });
        }
    }
    return out;
});

/* ░░ HELPERS ░░ */
async function indexWorkspaceFolder(folder: WorkspaceFolder) {
    const root = fileURLToPath(folder.uri);      // ← from URI → fs path
    const cRe = /\.c$/i;                         // match .c source files
    const queue: string[] = [root];

    while (queue.length) {
        const dir = queue.pop()!;
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                queue.push(full);
            } else if (cRe.test(entry)) {
                const content = fs.readFileSync(full, 'utf8');
                const doc = TextDocument.create(
                    pathToFileURL(full).toString(),  // ← fs path → URI
                    'enscript',
                    0,
                    content
                );
                indexDocument(doc);
            }
        }
    }
}

function indexDocument(doc: TextDocument): void {
    purgeDocument(doc.uri);
    const defs = parseSymbols(doc);

    for (const { name, location } of defs) {
        if (!symbolTable.has(name)) {
            symbolTable.set(name, []);
        }
        symbolTable.get(name)!.push(location);

        if (!reverseIndex.has(doc.uri)) {
            reverseIndex.set(doc.uri, new Set());
        }
        reverseIndex.get(doc.uri)!.add(name);
    }
    connection.console.log(
        `[EnScript] indexed ${defs.length} symbols in ${doc.uri}`
    );
}

function purgeDocument(uri: string): void {
    const set = reverseIndex.get(uri);
    if (!set) {
        return;
    }

    for (const sym of set) {
        const arr = symbolTable.get(sym);
        if (!arr) {
            continue;
        }
        symbolTable.set(
            sym,
            arr.filter(l => l.uri !== uri)
        );
        if (symbolTable.get(sym)!.length === 0) {
            symbolTable.delete(sym);
        }
    }
    reverseIndex.delete(uri);
}

function getWordAtPosition(uri: string, pos: Position): string {
    const doc = documents.get(uri);
    if (!doc) {
        return '';
    }

    /* grab the whole line text */
    const lineText = doc.getText(
        Range.create(pos.line, 0, pos.line, pos.character /* safe so far */)
    ) + doc.getText(
        Range.create(pos.line, pos.character, pos.line, pos.character + 256)
    ); // small tail read to avoid 2 reads of the full doc

    /* split once instead of substring gymnastics */
    const left  = lineText.slice(0, pos.character).match(/\w+$/)?.[0] ?? '';
    const right = lineText.slice(pos.character).match(/^\w+/)?.[0] ?? '';
    return left + right;
}

/* ░░ START ░░ */
documents.listen(connection);
connection.listen();
