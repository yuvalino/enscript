import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, Location, SymbolInformation, SymbolKind, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { parse, ParseError, ClassDeclNode, File, SymbolNodeBase } from '../ast/parser';
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
        if (this.docCache.has(doc.uri)) {
            return this.docCache.get(doc.uri)!;
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
            return { body: [] };
        }
    }

    resolveSymbolAtPosition(doc: TextDocument, pos: Position) {
        const ast = this.ensure(doc);
        const offset = doc.offsetAt(pos);

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
            if (offset >= c.start && offset <= c.end) {
                result.push({
                    name: c.name,
                    kind: c.kind,
                    type: c.returnType || c.type || undefined,
                    location: {
                        uri: doc.uri,
                        range: {
                            start: doc.positionAt(c.start),
                            end: doc.positionAt(c.end)
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

    resolveDefinition(doc: TextDocument, _pos: Position): SymbolNodeBase | null {
        const ast = this.ensure(doc);
        const offset = doc.offsetAt(_pos);

        // Find the identifier under cursor
        const target = getTokenAtPosition(doc.getText(), offset);
        if (target?.kind != TokenKind.Identifier)
            return null;

        const name = target.value;

        console.info(`resolveDefinition: "${name}"`);

        // Search top-level and class members
        const all: SymbolNodeBase[] = [];

        for (const node of ast.body) {
            all.push(node);

            if (node.kind === 'ClassDecl' && Array.isArray((node as any).members)) {
                for (const member of (node as ClassDeclNode).members) {
                    all.push(member);
                }
            }
        }

        // Return the first exact name match
        for (const sym of all) {
            if (sym.name === name) return sym;
        }

        return null;
    }

    getHover(doc: TextDocument, _pos: Position): string | null {
        const symbols = this.resolveSymbolAtPosition(doc, _pos);
        if (symbols.length === 0) return null;

        return symbols
            .map((s) =>
                s.type
                    ? `${s.type} ${s.name}()`
                    : `${s.kind} ${s.name}`
            )
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
            for (const node of (ast.body as any[])) {
                if (!node.name) continue;
                res.push({
                    name: node.name,
                    kind: SymbolKind.Class,
                    location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
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
