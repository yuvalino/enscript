import { lex } from '../server/src/analysis/lexer/lexer';
import { TokenKind } from '../server/src/analysis/lexer/token';

test('lexes keywords and identifiers', () => {
    const toks = lex('class Foo {}');
    expect(toks[0].kind).toBe(TokenKind.Keyword);
    expect(toks[1].value).toBe('Foo');
});
