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

        const analyser = Analyzer.instance();
        const symbol = analyser.resolveDefinition(doc, params.position) as any;
        if (!symbol) return [];

        const location: Location = {
            uri: doc.uri,
            range: {
                start: doc.positionAt(symbol.nameStart),
                end: doc.positionAt(symbol.nameEnd)
            }
        };
        return location;
    });
}
