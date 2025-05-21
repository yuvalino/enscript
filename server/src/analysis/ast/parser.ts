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
    Connection,
    Diagnostic,
    DiagnosticSeverity
} from 'vscode-languageserver';
import { Token, TokenKind } from '../lexer/token';
import { lex } from '../lexer/lexer';

export class ParseError extends Error {
    constructor(
        public readonly uri: string,
        public readonly line: number,
        public readonly column: number,
        message: string
    ) {
        super(message);
        this.name = 'ParseError';
    }
}

/* ─────────────────────── config tables ──────────────────────────── */
const modifiers = new Set(['proto', 'native', 'modded', 'owned', 'ref']);
const primitives = new Set([
    'void',
    'bool',
    'int',
    'float',
    'string',
    'vector'
]);

const isModifier = (t: Token) =>
    t.kind === TokenKind.Keyword && modifiers.has(t.value);

export type NodeKind =
  | 'ClassDecl'
  | 'EnumDecl'
  | 'Typedef'
  | 'FunctionDecl'
  | 'VarDecl';

export interface NodeBase {
    kind: NodeKind;
    start: number;
    end: number;
}

export interface SymbolNodeBase extends NodeBase {
    name: string;
    nameStart: number;
    nameEnd: number;
    modifiers: string[];
}

export interface ClassDeclNode extends SymbolNodeBase {
    kind: 'ClassDecl';
    base?: string;
    members: SymbolNodeBase[];
}

export interface EnumDeclNode extends SymbolNodeBase {
    kind: 'EnumDecl';
    members: string[];
}

export interface TypedefNode extends SymbolNodeBase {
    kind: 'Typedef';
    oldType: string;
}

export interface FunctionDeclNode extends SymbolNodeBase {
    kind: 'FunctionDecl';
    parameters: string[];
    returnType: string;
    locals: string[];
}

export interface VarDeclNode extends SymbolNodeBase {
    kind: 'VarDecl';
    type: string;
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

    const peek = () => toks[pos];
    const next = () => toks[pos++];
    const eof  = () => peek().kind === TokenKind.EOF;

    const throwErr = (t: Token, want = 'token'): never => {
        const p = doc.positionAt(t.start);
        throw new ParseError(
            doc.uri,
            p.line + 1,
            p.character + 1,
            `expected ${want}, got '${t.value}'`
        );
    };

    /* skip comments / #ifdef lines */
    const skipTrivia = () => {
        while (
            peek().kind === TokenKind.Comment ||
            peek().kind === TokenKind.Preproc
        )
            next();
    };

    /* read & return one identifier or keyword token */
    const readTypeLike = (): Token => {
        skipTrivia();
        const t = peek();
        if (
            t.kind === TokenKind.Identifier ||
            (t.kind === TokenKind.Keyword && primitives.has(t.value))
        )
            return next();
        return throwErr(t, 'type identifier');
    };

    /* scan parameter list quickly, ignore default values */
    const fastParamScan = (): string[] => {
        const list: string[] = [];
        expect('(');
        let depth = 1;
        while (depth > 0 && !eof()) {
            const t = next();
            if (t.value === '(') depth++;
            else if (t.value === ')') depth--;
            else if (depth === 1 && t.kind === TokenKind.Identifier) {
                list.push(t.value);
            }
        }
        return list;
    };

    const expect = (val: string) => {
        skipTrivia();
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
        skipTrivia();
        if (eof()) break;

        const node = parseDecl(0); // depth = 0
        if (node) file.body.push(node);
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
    function parseDecl(depth: number): SymbolNodeBase | null {
        skipTrivia();

        // modifiers are allowed on functions, variables, class members
        const mods: string[] = [];
        while (isModifier(peek())) mods.push(next().value);

        const t = peek();

        // class
        if (t.value === 'class') {
            next();
            const nameTok = expectIdentifier();
            let base: string | undefined;
            if (peek().value === ':' || peek().value === 'extends') {
                next();
                base = expectIdentifier().value;
            }
            expect('{');
            const members: SymbolNodeBase[] = [];
            while (peek().value !== '}' && !eof()) {
                const m = parseDecl(depth + 1);
                if (m) members.push(m);
            }
            expect('}');
            if (peek().value === ';') next(); // optional

            return {
                kind: 'ClassDecl',
                name: nameTok.value,
                nameStart: nameTok.start,
                nameEnd: nameTok.end,
                base: base,
                modifiers: mods,
                members: members,
                start: t.start,
                end: peek().end
            } as ClassDeclNode;
        }

        // enum
        if (t.value === 'enum') {
            next();
            const nameTok = expectIdentifier();
            expect('{');
            const enumerators: string[] = [];
            while (peek().value !== '}' && !eof()) {
                if (peek().kind === TokenKind.Identifier)
                    enumerators.push(next().value);
                else next();
            }
            expect('}');
            if (peek().value === ';') next();
            return {
                kind: 'EnumDecl',
                name: nameTok.value,
                nameStart: nameTok.start,
                nameEnd: nameTok.end,
                members: enumerators,
                start: t.start,
                end: peek().end
            } as EnumDeclNode;
        }

        // typedef
        if (t.value === 'typedef') {
            next();
            const oldTy = expectIdentifier().value;
            const nameTok = expectIdentifier();
            if (peek().value === ';') next();
            return {
                kind: 'Typedef',
                oldType: oldTy,
                name: nameTok.value,
                nameStart: nameTok.start,
                nameEnd: nameTok.end,
                start: t.start,
                end: peek().end
            } as TypedefNode;
        }

        // function OR variable
        const typeTok = readTypeLike();
        const nameTok = expectIdentifier();

        if (peek().value === '(') {
            const params = fastParamScan();
            let locals: string[] = [];

            /* body? */
            if (peek().value === '{') {
                next();
                let depth = 1;
                while (depth > 0 && !eof()) {
                    const t = next();
                    if (t.value === '{') depth++;
                    else if (t.value === '}') depth--;
                    else if (
                        depth === 1 &&
                        t.kind === TokenKind.Identifier &&
                        peek().kind === TokenKind.Identifier
                    ) {
                        // pattern:  <type> <name>
                        const maybeName = peek();
                        if (
                            toks[pos + 1] &&
                            toks[pos + 1].value === ';'
                        ) {
                            locals.push(maybeName.value);
                        }
                    }
                }
            } else {
                expect(';');
            }

            return {
                kind: 'FunctionDecl',
                name: nameTok.value,
                nameStart: nameTok.start,
                nameEnd: nameTok.end,
                returnType: typeTok.value,
                parameters: params,
                locals: locals,
                modifiers: mods,
                start: typeTok.start,
                end: peek().end
            } as FunctionDeclNode;
        }

        // variable
        expect(';');
        return {
            kind: 'VarDecl',
            name: nameTok.value,
            nameStart: nameTok.start,
            nameEnd: nameTok.end,
            type: typeTok.value,
            modifiers: mods,
            start: typeTok.start,
            end: peek().end
        } as VarDeclNode;
    }

    // support helpers
    function expectIdentifier(): Token {
        skipTrivia();
        const t = peek();
        if (t.kind !== TokenKind.Identifier) throwErr(t, 'identifier');
        next();
        return t;
    }
}
