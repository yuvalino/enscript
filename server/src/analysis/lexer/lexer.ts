import { Token, TokenKind } from './token';
import { keywords, punct } from './rules';

export function lex(text: string): Token[] {
    const toks: Token[] = [];
    let i = 0;

    const push = (kind: TokenKind, value: string, start: number) => {
        toks.push({ kind, value, start, end: i });
    };

    while (i < text.length) {
        const ch = text[i];
        const start = i;

        // whitespace
        if (/\s/.test(ch)) {
            i++;
            continue;
        }

        // single line comment
        if (ch === '/' && i + 1 < text.length && text[i + 1] === '/') {
            i += 2; // skip “//”
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
            push(TokenKind.Comment, text.slice(start, i), start);
            continue;
        }

        // multi line comment
        if (ch === '/' && i + 1 < text.length && text[i + 1] === '*') {
            i += 2; // skip /*
            while (
                i + 1 < text.length &&
                !(text[i] === '*' && text[i + 1] === '/')
            ) {
                i++;
            }
            i += 2; // skip closing */
            push(TokenKind.Comment, text.slice(start, i), start);
            continue;
        }

        // pre-processor (#define, #ifdef …)
        if (ch === '#') {
            while (i < text.length && text[i] !== '\n' && text[i] !== '\r') i++;
            push(TokenKind.Preproc, text.slice(start, i), start);
            continue;
        }

        // string literal
        if (ch === '"') {
            i++;
            while (i < text.length && text[i] !== '"') {
                if (text[i] === '\\') i += 2;
                else i++;
            }
            i++; // consume closing "
            push(TokenKind.String, text.slice(start, i), start);
            continue;
        }

        // number literal
        if (/\d/.test(ch)) {
            while (i < text.length && /[0-9.eE+-]/.test(text[i])) i++;
            push(TokenKind.Number, text.slice(start, i), start);
            continue;
        }

        // identifier / keyword
        if (/[_A-Za-z]/.test(ch)) {
            while (i < text.length && /[_0-9A-Za-z]/.test(text[i])) i++;
            const value = text.slice(start, i);
            const kind = keywords.has(value)
                ? TokenKind.Keyword
                : TokenKind.Identifier;
            push(kind, value, start);
            continue;
        }

        // punctuation / operator
        if (punct.includes(ch)) {
            i++;
            push(TokenKind.Punctuation, ch, start);
            continue;
        }

        // unknown char → treat as operator
        i++;
        push(TokenKind.Operator, ch, start);
    }

    push(TokenKind.EOF, '', i);
    return toks;
}
