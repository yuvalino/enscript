import { Connection, Hover, HoverParams, MarkupKind, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';

export function registerHover(conn: Connection, docs: TextDocuments<TextDocument>): void {
  conn.onHover((params: HoverParams): Hover | null => {
    conn.console.info(`onHover ${params.textDocument.uri}`);
    const doc = docs.get(params.textDocument.uri);
    if (!doc) return null;

    const analyser = Analyzer.instance();
    const info = analyser.getHover(doc, params.position);
    if (!info) return null;

    return {
      contents: { kind: MarkupKind.Markdown, value: info }
    };
  });
}
