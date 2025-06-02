/**********************************************************************
 *  Mini-parser for Enforce/EnScript (DayZ / Arma Reforger flavour)
 *  – walks tokens once, builds a lightweight AST but captures:
 *      • classes  (base, modifiers, fields, methods)
 *      • enums    + enumerators
 *      • typedefs
 *      • free functions / globals
 *      • local variables inside method bodies
 *  – prints all collected symbols to the LSP output channel
 *********************************************************************/

import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    Position,
    Connection,
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver';
import { SymbolKind } from 'vscode-languageserver-types';
import { Token, TokenKind } from '../lexer/token';
import { lex } from '../lexer/lexer';
import * as url from 'node:url';

export class ParseError extends Error {
    constructor(
        public readonly uri: string,
        public readonly line: number,
        public readonly column: number,
        message: string
    ) {
        const fsPath = url.fileURLToPath(uri);
        super(`${message} (${fsPath}:${line}:${column})`);
        this.name = 'ParseError';
    }
}

// config tables
const modifiers = new Set(['override', 'proto', 'native', 'modded', 'owned', 'ref', 'reference', 'public', 'private', 'protected', 'static', 'const', 'out', 'inout', 'notnull', 'external', 'volatile', 'local', 'autoptr', 'event']);

const isModifier = (t: Token) =>
    t.kind === TokenKind.Keyword && modifiers.has(t.value);

export type NodeKind =
    | 'Type'
    | 'ClassDecl'
    | 'EnumDecl'
    | 'EnumMemberDecl'
    | 'Typedef'
    | 'FunctionDecl'
    | 'VarDecl';

export function toSymbolKind(kind: NodeKind): SymbolKind {
    switch (kind) {
        case 'ClassDecl':
            return SymbolKind.Class;
        case 'EnumDecl':
            return SymbolKind.Enum;
        case 'FunctionDecl':
            return SymbolKind.Function;
        case 'VarDecl':
            return SymbolKind.Variable;
        case 'Type':
        case 'Typedef':
            return SymbolKind.TypeParameter;
        default:
            return SymbolKind.Object; // Fallback
    }
}

export interface NodeBase {
    kind: NodeKind;
    uri: string;
    start: Position;
    end: Position;
}

export interface TypeNode extends NodeBase {
    identifier: string;
    genericArgs?: TypeNode[]; // undefined - not generic, 0 no types
    arrayDims: (number | string | undefined)[]; // T - arrayDims=[], T[3] - arrayDims=[3], T[3][2] - arrayDims=[3, 2], T[] = arrayDims[undefined], T[4][] - arrayDims[4, undefined]
    modifiers: string[];
}

export interface SymbolNodeBase extends NodeBase {
    name: string;
    nameStart: Position;
    nameEnd: Position;
    annotations: string[][];
    modifiers: string[];
}

export interface ClassDeclNode extends SymbolNodeBase {
    kind: 'ClassDecl';
    genericVars?: string[];
    base?: TypeNode;
    members: SymbolNodeBase[];
}

export interface EnumMemberDeclNode extends SymbolNodeBase {
    kind: 'EnumMemberDecl';
}

export interface EnumDeclNode extends SymbolNodeBase {
    kind: 'EnumDecl';
    base?: string;
    members: EnumMemberDeclNode[];
}

export interface TypedefNode extends SymbolNodeBase {
    kind: 'Typedef';
    oldType: TypeNode;
}

export interface VarDeclNode extends SymbolNodeBase {
    kind: 'VarDecl';
    type: TypeNode;
}

export interface FunctionDeclNode extends SymbolNodeBase {
    kind: 'FunctionDecl';
    parameters: VarDeclNode[];
    returnType: TypeNode;
    locals: VarDeclNode[];
}

export interface File {
    body: SymbolNodeBase[]
    version: number
}

// parse entry point
export function parse(
    doc: TextDocument,
    conn?: Connection            // optional – pass from index.ts to auto-log
): File {
    const toks = lex(doc.getText());
    let pos = 0;

    /* skip comments / #ifdef lines */
    const skipTrivia = () => {
        while (
            pos < toks.length &&
            (toks[pos].kind === TokenKind.Comment ||
                toks[pos].kind === TokenKind.Preproc)
        ) {
            pos++;
        }
    };

    function peek(): Token {
        skipTrivia();
        return toks[pos];
    }

    function next(): Token {
        skipTrivia();
        return toks[pos++];
    }

    function eof(): boolean {
        skipTrivia();
        return peek().kind === TokenKind.EOF;
    }

    const throwErr = (t: Token, want = 'token'): never => {
        const p = doc.positionAt(t.start);
        throw new ParseError(
            doc.uri,
            p.line + 1,
            p.character + 1,
            `expected ${want}, got '${t.value}' (${TokenKind[t.kind]})`
        );
    };

    /* read & return one identifier or keyword token */
    const readTypeLike = (): Token => {
        const t = peek();
        if (t.kind === TokenKind.Identifier)
            return next();
        return throwErr(t, 'type identifier');
    };

    /* scan parameter list quickly, ignore default values */
    const fastParamScan = (doc: TextDocument): VarDeclNode[] => {
        const list: VarDeclNode[] = [];
        expect('(');
        while (!eof() && peek().value !== ')') {
            const varDecl = expectVarDecl(doc, true);
            // ignore default values
            while (!eof() && peek().value !== ')' && peek().value !== ',')
                next();

            if (peek().value === ',') next();

            list.push(varDecl);
        }

        expect(')');

        return list;
    };

    const expect = (val: string) => {
        if (peek().value !== val) throwErr(peek(), `'${val}'`);
        return next();
    };

    // ast root
    const file: File = {
        body: [],
        version: doc.version
    };

    // main loop
    while (!eof()) {
        if (eof()) break;

        // skip semicolons
        if (peek().value === ';') {
            next();
            continue;
        }

        const nodes = parseDecl(doc, 0); // depth = 0
        file.body.push(...nodes);
    }

    /* pretty-log for debugging */
    console.info(
        `parsed ${file.body.length} top-level symbols from ${doc.uri}`
    );
    file.body.forEach((n) =>
        console.info(
            `  • ${n.kind}  ${'name' in n ? (n as any).name : ''}`
        )
    );

    return file;

    // declaration parser (recursive)
    function parseDecl(doc: TextDocument, depth: number, inline: boolean = false): SymbolNodeBase[] {

        // annotations and modifiers are allowed on functions, variables, class members
        const annotations: string[][] = [];
        while (peek().value === '[') {
            const ano = expectAnnotation();
            annotations.push(ano);
        }

        const mods: string[] = [];
        while (isModifier(peek())) {
            mods.push(next().value);
        }

        const t = peek();

        // class
        if (t.value === 'class') {
            next();
            const nameTok = expectIdentifier();
            let genericVars: string[] | undefined;
            // generic: Param<Class T1, Class T2>
            if (peek().value === '<') {
                next();
                genericVars = [];

                while (peek().value !== '>' && !eof()) {
                    expect('Class');
                    genericVars.push(expectIdentifier().value);
                    if (peek().value === ',') next();
                }

                expect('>');
            }
            let base: TypeNode | undefined;
            if (peek().value === ':' || peek().value === 'extends') {
                next();
                base = parseType(doc);
            }
            expect('{');
            const members: SymbolNodeBase[] = [];
            while (peek().value !== '}' && !eof()) {
                // skip semicolons
                if (peek().value === ';') {
                    next();
                    continue;
                }
                const m = parseDecl(doc, depth + 1);
                members.push(...m);
            }
            expect('}');

            return [{
                kind: 'ClassDecl',
                uri: doc.uri,
                name: nameTok.value,
                nameStart: doc.positionAt(nameTok.start),
                nameEnd: doc.positionAt(nameTok.end),
                base: base,
                annotations: annotations,
                modifiers: mods,
                members: members,
                start: doc.positionAt(t.start),
                end: doc.positionAt(peek().end)
            } as ClassDeclNode];
        }

        // enum
        if (t.value === 'enum') {
            next();
            const nameTok = expectIdentifier();
            let base: string | undefined;
            if (peek().value === ':' || peek().value === 'extends') {
                next();
                base = expectIdentifier().value;
            }
            expect('{');
            const enumerators: EnumMemberDeclNode[] = [];
            while (peek().value !== '}' && !eof()) {
                if (peek().kind === TokenKind.Identifier) {
                    const enumMemberNameTok = next();
                    enumerators.push({
                        kind: 'EnumMemberDecl',
                        uri: doc.uri,
                        name: enumMemberNameTok.value,
                        nameStart: doc.positionAt(enumMemberNameTok.start),
                        nameEnd: doc.positionAt(enumMemberNameTok.end),
                        start: doc.positionAt(enumMemberNameTok.start),
                        end: doc.positionAt(enumMemberNameTok.end),
                    } as EnumMemberDeclNode);
                }
                else next();
            }
            expect('}');

            return [{
                kind: 'EnumDecl',
                uri: doc.uri,
                name: nameTok.value,
                nameStart: doc.positionAt(nameTok.start),
                nameEnd: doc.positionAt(nameTok.end),
                base: base,
                members: enumerators,
                annotations: annotations,
                modifiers: mods,
                start: doc.positionAt(t.start),
                end: doc.positionAt(peek().end)
            } as EnumDeclNode];
        }

        // typedef
        if (t.value === 'typedef') {
            next();
            const oldType = parseType(doc);
            const nameTok = expectIdentifier();

            return [{
                kind: 'Typedef',
                uri: doc.uri,
                oldType: oldType,
                name: nameTok.value,
                annotations: annotations,
                modifiers: mods,
                nameStart: doc.positionAt(nameTok.start),
                nameEnd: doc.positionAt(nameTok.end),
                start: doc.positionAt(t.start),
                end: doc.positionAt(peek().end)
            } as TypedefNode];
        }

        // function OR variable
        const baseTypeNode = parseType(doc);
        let nameTok = expectIdentifier();

        if (peek().value === '(') {
            const params = fastParamScan(doc);

            /* body? */
            if (peek().value === '{') {
                next();
                let depth = 1;
                while (depth > 0 && !eof()) {
                    const t = next();
                    if (t.value === '{') depth++;
                    else if (t.value === '}') depth--;
                }
            }

            return [{
                kind: 'FunctionDecl',
                uri: doc.uri,
                name: nameTok.value,
                nameStart: doc.positionAt(nameTok.start),
                nameEnd: doc.positionAt(nameTok.end),
                returnType: baseTypeNode,
                parameters: params,
                locals: [], //locals,
                annotations: annotations,
                modifiers: mods,
                start: baseTypeNode.start,
                end: doc.positionAt(peek().end)
            } as FunctionDeclNode];
        }

        // variable

        const vars: VarDeclNode[] = [];
        while (!eof()) {
            const typeNode = structuredClone(baseTypeNode);

            // Support trailing `T name[]`
            if (peek().value === '[') {

                // Prevent additional [] after identifier if already declared in type
                if (typeNode.arrayDims.length !== 0) {
                    throwErr(peek(), "not another [");
                }

                parseArrayDims(doc, typeNode);
            }

            // value initialization (skip for now)
            if (peek().value === '=') {
                next();

                while ((inline && peek().value !== ',' && peek().value !== ')') ||
                    (!inline && peek().value !== ';' && peek().value !== ',')) {
                    const curTok = next();
                    if (curTok.value === '(' || curTok.value === '[' || curTok.value === '{' || curTok.value === '<') {
                        // skip initializer expression
                        let depth = 1;
                        while (!eof() && depth > 0) {
                            const val = peek().value;
                            if (val === '(' || val === '[' || val === '{' || val === '<') depth++;
                            if (val === ')' || val === ']' || val === '}' || val === '>') depth--;
                            next();
                        }
                    }
                    else if (curTok.value === '-' && peek().kind === TokenKind.Number) {
                        next();
                    }
                    else if (curTok.kind !== TokenKind.Keyword && curTok.kind !== TokenKind.Identifier && curTok.kind !== TokenKind.Number &&
                        curTok.kind !== TokenKind.String && curTok.value !== '.' && curTok.value !== '+' && curTok.value !== '|') {
                        throwErr(curTok, "initialization expression");
                    }
                }
            }

            vars.push({
                kind: 'VarDecl',
                uri: doc.uri,
                name: nameTok.value,
                nameStart: doc.positionAt(nameTok.start),
                nameEnd: doc.positionAt(nameTok.end),
                type: baseTypeNode,
                annotations: annotations,
                modifiers: mods,
                start: baseTypeNode.start,
                end: doc.positionAt(peek().end)
            } as VarDeclNode);

            if (!inline && peek().value === ',') {
                next();
                nameTok = expectIdentifier();
                continue;
            }

            break;
        }

        return vars;
    }

    function parseType(doc: TextDocument): TypeNode {

        const mods: string[] = [];

        while (isModifier(peek())) {
            mods.push(next().value);
        }

        const startTok = readTypeLike();
        const identifier = startTok.value;

        const node: TypeNode = {
            kind: 'Type',
            uri: doc.uri,
            start: doc.positionAt(startTok.start),
            end: doc.positionAt(startTok.end),
            identifier: identifier,
            arrayDims: [],
            modifiers: mods,
        };

        // generic: map<string, vector>
        if (peek().value === '<') {
            next();
            node.genericArgs = [];

            while (peek().value !== '>' && !eof()) {
                node.genericArgs.push(parseType(doc));
                if (peek().value === ',') next();
            }

            const endTok = expect('>');
            node.end = doc.positionAt(endTok.end);
        }

        parseArrayDims(doc, node);

        return node;
    }

    function parseTypeAndName(doc: TextDocument): { type: TypeNode; name: Token; } {
        const typeNode = parseType(doc);

        const nameTok = expectIdentifier();

        // Support trailing `T name[]`
        if (peek().value === '[') {

            // Prevent additional [] after identifier if already declared in type
            if (typeNode.arrayDims.length !== 0) {
                throwErr(peek(), "not another [");
            }

            parseArrayDims(doc, typeNode);
        }

        return {
            type: typeNode,
            name: nameTok
        };
    }

    function parseArrayDims(doc: TextDocument, typeNode: TypeNode) {
        // array: T[3], T[]
        while (peek().value === '[') {
            next(); // [
            let size: number | string | undefined = undefined;

            if (peek().kind === TokenKind.Number) {
                size = parseInt(next().value);
            }
            else if (peek().kind === TokenKind.Identifier) {
                size = next().value;
            }

            const endTok = expect(']');
            typeNode.arrayDims.push(size);
            typeNode.end = doc.positionAt(endTok.end);
        }
    }

    function expectVarDecl(doc: TextDocument, inline: boolean): VarDeclNode {
        const decl = parseDecl(doc, 0, inline);
        if (!decl) throwErr(peek(), "no declaration");
        if (decl.length !== 1) throwErr(peek(), `internal parser error (decl.length:${decl.length} != 1)`);
        if (decl[0].kind !== "VarDecl") throwErr(peek(), `not a variable declaration ${decl[0].kind}`);
        return decl[0] as VarDeclNode;
    }

    // support helpers
    function expectIdentifier(): Token {
        const t = next();

        // Allow destructor names like ~Foo
        if (t.kind === TokenKind.Operator && t.value === '~' && peek().kind === TokenKind.Identifier) {
            const id = next();
            return {
                kind: TokenKind.Identifier,
                value: '~' + id.value,
                start: t.start,
                end: id.end
            };
        }

        if (t.kind !== TokenKind.Identifier) throwErr(t, 'identifier');
        return t;
    }

    function expectAnnotation(): string[] {
        const startTok = expect('[');

        const args: string[] = [expectIdentifier().value];

        if (peek().value === '(') {
            expect('(');
            while (peek().value !== ')') {
                if (peek().kind === TokenKind.String || peek().kind === TokenKind.Number) {
                    args.push(next().value);
                } else {
                    next(); // skip unexpected stuff
                }

                if (peek().value === ',') next();
            }
            expect(')');
        }

        const endTok = expect(']');

        return args;
    }
}
