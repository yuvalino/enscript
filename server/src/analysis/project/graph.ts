import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, Location, SymbolInformation, SymbolKind, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { parse, ParseError, ClassDeclNode, File, SymbolNodeBase, FunctionDeclNode, VarDeclNode, TypedefNode } from '../ast/parser';
import { prettyPrint } from '../ast/printer';
import { lex } from '../lexer/lexer';
import { Token, TokenKind } from '../lexer/token';
import * as url from 'node:url';

interface SymbolEntry {
    name: string;
    kind: 'function' | 'class' | 'variable' | 'parameter' | 'field' | 'typedef' | 'enum';
    type?: string;
    location: {
        uri: string;
        range: Range;
    };
    scope: 'global' | 'class' | 'function';
}

/**
 * Returns the token at a specific offset (e.g. mouse hover or cursor position).
 * Lexes only a small window around the position for performance.
 */
export function getTokenAtPosition(text: string, offset: number): Token | null {
    const windowSize = 64;
    const start = Math.max(0, offset - windowSize);
    const end = Math.min(text.length, offset + windowSize);
    const slice = text.slice(start, end);

    const tokens = lex(slice);

    for (const t of tokens) {
        const absStart = start + t.start;
        const absEnd = start + t.end;

        if (offset >= absStart && offset <= absEnd) {
            return {
                ...t,
                start: absStart,
                end: absEnd
            };
        }
    }

    return null;
}

function formatDeclaration(node: SymbolNodeBase): string {
    let fmt: string | null = null;
    switch (node.kind) {
        case 'FunctionDecl': {
            const _node = node as FunctionDeclNode;
            fmt = `${_node.returnType} ${_node.name}(${_node.parameters?.join(', ') ?? ''})`;
            break;
        }

        case 'VarDecl': {
            const _node = node as VarDeclNode;
            fmt = `${_node.type} ${_node.name}`;
            break;
        }

        case 'ClassDecl': {
            const _node = node as ClassDeclNode;
            fmt = `class ${_node.name}` + (_node.base ? ` : ${_node.base}` : '');
            break;
        }

        case 'EnumDecl': {
            const _node = node as ClassDeclNode;
            fmt = `enum ${_node.name}`;
            break;
        }

        case 'Typedef': {
            const _node = node as TypedefNode;
            fmt = `typedef ${_node.oldType} ${_node.name}`;
            break;
        }
    }

    if (fmt)
        return '```enscript\n' + fmt + '\n```'

    return `(Unknown ${node.kind}) ${node.name}`;
}

/** Singleton façade that lazily analyses files and answers LSP queries. */
export class Analyzer {
    private static _instance: Analyzer;
    static instance(): Analyzer {
        if (!Analyzer._instance) Analyzer._instance = new Analyzer();
        return Analyzer._instance;
    }

    private docCache = new Map<string, File>();

    private ensure(doc: TextDocument): File {
        // 1 · cache hit
        const currVersion = doc.version;
        const cachedFile = this.docCache.get(doc.uri);

        if (cachedFile && cachedFile.version === currVersion) {
            return cachedFile;
        }

        try {
            // 2 · happy path ─ parse & cache
            const ast = parse(doc);           // pass full TextDocument
            this.docCache.set(doc.uri, ast);
            return ast;
        } catch (err) {
            // 3 · graceful error handling
            if (err instanceof ParseError) {
                // VS Code recognises “path:line:col” as a jump-to link
                const fsPath = url.fileURLToPath(err.uri);          // file:/// → p:\foo\bar.c
                console.error(`${fsPath}:${err.line}:${err.column}  ${err.message}`);

                // // also publish a real diagnostic so the Problems panel shows it
                // const diagnostic: Diagnostic = {
                //     message: err.message,
                //     range: {
                //         start: { line: err.line - 1, character: err.column - 1 },
                //         end:   { line: err.line - 1, character: err.column     }
                //     },
                //     severity: DiagnosticSeverity.Error,
                //     source:   'parser'
                // };
                // connection.sendDiagnostics({ uri: err.uri, diagnostics: [diagnostic] });
                console.error(String(err.stack));
            } else {
                // unexpected failure
                console.error(String(err));
            }

            // 4 · return an empty stub so callers can continue
            return { body: [], version: 0 };
        }
    }

    resolveSymbolAtPosition(doc: TextDocument, pos: Position) {
        const ast = this.ensure(doc);

        const result: SymbolEntry[] = [];

        const candidates: any[] = [];

        // Flatten top-level
        for (const node of ast.body) {
            if (node.name)
                candidates.push({ ...node, scope: 'global' });

            if (node.kind === 'ClassDecl') {
                for (const member of (node as ClassDeclNode).members || []) {
                    if (member.name) {
                        candidates.push({ ...member, scope: 'class', parent: node });
                    }
                }
            }
        }

        // Try to find closest match
        for (const c of candidates) {
            if (pos >= c.start && pos <= c.end) {
                result.push({
                    name: c.name,
                    kind: c.kind,
                    type: c.returnType || c.type || undefined,
                    location: {
                        uri: doc.uri,
                        range: {
                            start: c.start,
                            end: c.end
                        }
                    },
                    scope: c.scope
                });
            }
        }

        return result;
    }

    getCompletions(doc: TextDocument, _pos: Position) {
        const ast = this.ensure(doc);
        return ast.body.filter((n: any) => n.name);
    }

    resolveDefinitions(doc: TextDocument, _pos: Position): SymbolNodeBase[] {
        const offset = doc.offsetAt(_pos);

        const token = getTokenAtPosition(doc.getText(), offset);
        if (!token || token.kind !== TokenKind.Identifier) return [];

        const name = token.value;
        console.info(`resolveDefinitions: "${name}"`);

        const matches: SymbolNodeBase[] = [];

        // iterate all loaded documents
        for (const [uri, ast] of this.docCache) {
            for (const node of ast.body) {
                // top-level match
                if (node.name === name) {
                    matches.push(node as SymbolNodeBase);
                }

                // class member match
                if (node.kind === 'ClassDecl') {
                    for (const member of (node as ClassDeclNode).members) {
                        if (member.name === name) {
                            matches.push(member as SymbolNodeBase);
                        }
                    }
                }
            }
        }

        return matches;
    }

    getHover(doc: TextDocument, _pos: Position): string | null {
        const symbols = this.resolveDefinitions(doc, _pos);
        if (symbols.length === 0) return null;

        return symbols
            .map((s) => formatDeclaration(s))
            .join('\n\n');
    }

    findReferences(doc: TextDocument, _pos: Position, _inc: boolean) {
        return [];
    }

    prepareRename(doc: TextDocument, _pos: Position): Range | null {
        return null;
    }

    renameSymbol(doc: TextDocument, _pos: Position, _newName: string) {
        return [] as { uri: string; range: Range }[];
    }

    getWorkspaceSymbols(): SymbolInformation[] {
        const res: SymbolInformation[] = [];
        for (const [uri, ast] of this.docCache) {
            for (const node of ast.body) {
                if (!node.name) continue;
                res.push({
                    name: node.name,
                    kind: SymbolKind.Class,
                    location: { uri, range: { start: node.nameStart, end: node.nameEnd } }
                });
            }
        }
        return res;
    }

    runDiagnostics(doc: TextDocument) {
        const ast = this.ensure(doc);
        const diags = [] as any[];
        for (const node of (ast.body as any[])) {
            if (node.kind === 'Typedef') {
                diags.push({
                    message: `Typedef '${node.name}' is never used`,
                    range: { start: doc.positionAt(node.start), end: doc.positionAt(node.end) },
                    severity: 2
                });
            }
        }
        return diags;
    }
}
