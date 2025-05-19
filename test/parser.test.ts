import { parse } from '../server/src/analysis/ast/parser';
import { TextDocument } from 'vscode-languageserver-textdocument';

test('parses class declaration', () => {
    const doc = TextDocument.create('file:///test.enscript', 'enscript', 1, 'class Foo { };');
    const ast = parse(doc);
    expect(ast.body[0]).toHaveProperty('kind', 'ClassDecl');
});
