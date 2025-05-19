import {
  Connection,
  Location,
  ReferenceParams,
  TextDocuments
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';

export function registerReferences(conn: Connection, docs: TextDocuments<TextDocument>): void {
  conn.onReferences((params: ReferenceParams): Location[] => {
    const doc = docs.get(params.textDocument.uri);
    if (!doc) return [];

    const analyser = Analyzer.instance();
    return analyser.findReferences(doc, params.position, params.context.includeDeclaration);
  });
}
