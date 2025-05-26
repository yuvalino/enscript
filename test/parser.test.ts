import { parse } from '../server/src/analysis/ast/parser';
import { TextDocument } from 'vscode-languageserver-textdocument';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'node:url';

const CURRENT_DIR = "P:\\enscript\\test";

test('parses class declaration', () => {
    const doc = TextDocument.create('file:///test.enscript', 'enscript', 1, 'class Foo { };');
    const ast = parse(doc);
    expect(ast.body[0]).toHaveProperty('kind', 'ClassDecl');
});

test('playground', () => {
    const target_file = path.join("P:\\enscript\\test", "test_enscript.c");
    const text = fs.readFileSync(target_file, "utf8");
    const doc = TextDocument.create(url.pathToFileURL(target_file).href, 'enscript', 1, text);
    const ast = parse(doc);
    expect(ast.body[0]).toHaveProperty('kind', 'ClassDecl');
});