import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, Location, SymbolInformation, SymbolKind, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { parse, ParseError, ClassDeclNode, File, SymbolNodeBase, FunctionDeclNode, VarDeclNode, TypedefNode, toSymbolKind, EnumDeclNode, EnumMemberDeclNode, TypeNode } from '../ast/parser';
import { prettyPrint } from '../ast/printer';
import { lex } from '../lexer/lexer';
import { Token, TokenKind } from '../lexer/token';
import { normalizeUri } from '../../util/uri';
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
            fmt = `${(_node.modifiers.length ? _node.modifiers.join(' ') + ' ': '')}${_node.returnType.identifier} ${_node.name}(${_node.parameters?.map(p => (p.modifiers.length ? p.modifiers.join(' ') + ' ': '') + p.type.identifier + ' ' + p.name).join(', ') ?? ''})`;
            break;
        }

        case 'VarDecl': {
            const _node = node as VarDeclNode;
            fmt = `${(_node.modifiers.length ? _node.modifiers.join(' ') + ' ': '')}${_node.type.identifier} ${_node.name}`;
            break;
        }

        case 'ClassDecl': {
            const _node = node as ClassDeclNode;
            fmt = `${(_node.modifiers.length ? _node.modifiers.join(' ') + ' ': '')}class ${_node.name}` + (_node.base?.identifier ? ` : ${_node.base.identifier}` : '');
            break;
        }

        case 'EnumDecl': {
            const _node = node as ClassDeclNode;
            fmt = `${(_node.modifiers.length ? _node.modifiers.join(' ') + ' ': '')}enum ${_node.name}`;
            break;
        }

        case 'EnumMemberDecl': {
            const _node = node as EnumMemberDeclNode;
            fmt = `${_node.name}`;
            break;
        }

        case 'Typedef': {
            const _node = node as TypedefNode;
            fmt = `typedef ${_node.oldType.identifier} ${_node.name}`;
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
        const cachedFile = this.docCache.get(normalizeUri(doc.uri));

        if (cachedFile && cachedFile.version === currVersion) {
            return cachedFile;
        }

        try {
            // 2 · happy path ─ parse & cache
            const ast = parse(doc);           // pass full TextDocument
            this.docCache.set(normalizeUri(doc.uri), ast);
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

                // enum member match
                if (node.kind === 'EnumDecl') {
                    for (const member of (node as EnumDeclNode).members) {
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

    getInnerWorkspaceSymbols(uri: string, query: string, members: SymbolNodeBase[], containerName?: string): SymbolInformation[] {
        const res: SymbolInformation[] = [];
        for (const node of members) {
            if (node.name.includes(query)) {
                res.push({
                    name: node.name,
                    kind: toSymbolKind(node.kind),
                    containerName: containerName,
                    location: { uri, range: { start: node.nameStart, end: node.nameEnd } }
                });
            }

            if (node.kind === "ClassDecl") {
                res.push(...this.getInnerWorkspaceSymbols(uri, query, (node as ClassDeclNode).members, node.name));
            }

            if (node.kind === "EnumDecl") {
                for (const enumerator of (node as EnumDeclNode).members) {
                    if (enumerator.name.includes(query)) {
                        res.push({
                            name: enumerator.name,
                            kind: SymbolKind.EnumMember,
                            containerName: node.name,
                            location: { uri, range: { start: enumerator.nameStart, end: enumerator.nameEnd } }
                        })
                    }
                }
            }
        }
        return res
    }

    getWorkspaceSymbols(query: string): SymbolInformation[] {
        const res: SymbolInformation[] = [];
        for (const [uri, ast] of this.docCache) {
            res.push(...this.getInnerWorkspaceSymbols(uri, query, ast.body, undefined));
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

    private toSymbolKindName(kind: string): SymbolEntry['kind'] {
        switch (kind) {
            case 'ClassDecl': return 'class';
            case 'FunctionDecl': return 'function';
            case 'VarDecl': return 'variable';
            case 'Typedef': return 'typedef';
            case 'EnumDecl': return 'enum';
            case 'EnumMemberDecl': return 'field';
            default: return 'variable';
        }
    }

    private dumpType(type: TypeNode): any {
        return {
            identifier: type.identifier,
            modifiers: type.modifiers,
            arrayDims: type.arrayDims,
            genericArgs: type.genericArgs?.map(this.dumpType) ?? []
        };
    }


    private dumpNode(node: SymbolNodeBase): any | null {
        if (!node.name) return null;

        const base = {
            type: this.toSymbolKindName(node.kind),
            name: node.name,
            modifiers: node.modifiers,
            location: {
                range: { start: node.start, end: node.end },
                nameRange: { start: node.nameStart, end: node.nameEnd }
            }
        };

        switch (node.kind) {
            case 'ClassDecl': {
                const c = node as ClassDeclNode;
                return {
                    ...base,
                    base: c.base ? this.dumpType(c.base) : undefined,
                    members: c.members.map(m => this.dumpNode(m)).filter(Boolean)
                };
            }

            case 'EnumDecl': {
                const e = node as EnumDeclNode;
                return {
                    ...base,
                    baseType: e.base,
                    members: e.members.map(this.dumpNode.bind(this))
                };
            }

            case 'FunctionDecl': {
                const f = node as FunctionDeclNode;
                return {
                    ...base,
                    returnType: this.dumpType(f.returnType),
                    parameters: f.parameters.map(p => ({
                        name: p.name,
                        type: this.dumpType(p.type)
                    })),
                    locals: f.locals.map(l => ({
                        name: l.name,
                        type: this.dumpType(l.type)
                    }))
                };
            }

            case 'Typedef': {
                const t = node as TypedefNode;
                return {
                    ...base,
                    type: this.dumpType(t.oldType)
                };
            }

            case 'VarDecl': {
                const v = node as VarDeclNode;
                return {
                    ...base,
                    type: this.dumpType(v.type)
                };
            }

            case 'EnumMemberDecl': {
                return base;
            }

            default:
                return base;
        }
    }


    dumpDiagnostics(): Record<string, any[]> {
        const output: Record<string, any[]> = {};

        for (const [uri, file] of this.docCache) {
            const items: any[] = [];

            for (const node of file.body) {
                items.push(node);
            }

            output[uri] = items;
        }

        return output;
    }

}
