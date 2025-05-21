import {
  Connection,
  Definition,
  DefinitionParams,
  Location,
  TextDocuments
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';

export function registerDefinition(conn: Connection, docs: TextDocuments<TextDocument>): void {
    conn.onDefinition((params: DefinitionParams): Definition => {
        const doc = docs.get(params.textDocument.uri);
        if (!doc) return [];

        const analyzer = Analyzer.instance();
        const symbols = analyzer.resolveDefinitions(doc, params.position);
        if (symbols.length === 0) return [];

        const locations: Location[] = symbols.map(symbol => ({
            uri: doc.uri,
            range: {
                start: doc.positionAt(symbol.nameStart ?? symbol.start),
                end: doc.positionAt(symbol.nameEnd ?? symbol.end)
            }
        }));

        return locations;
    });
}
