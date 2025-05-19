import {
  CompletionItemKind,
  CompletionItem,
  CompletionParams,
  Connection,
  TextDocuments
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';

export function registerCompletion(
  conn: Connection,
  docs: TextDocuments<TextDocument>
): void {
  conn.onCompletion((params: CompletionParams): CompletionItem[] => {
    const doc = docs.get(params.textDocument.uri);
    if (!doc) return [];

    const analyser = Analyzer.instance();
    const items = analyser.getCompletions(doc, params.position);

    return items.map(i => ({
      label: (i as any).name,
      kind: convertKind(i.kind)
    }));
  });
}

function convertKind(kind: string): CompletionItemKind {
  switch (kind) {
    case 'class':
      return CompletionItemKind.Class;
    case 'function':
      return CompletionItemKind.Function;
    case 'variable':
      return CompletionItemKind.Variable;
    default:
      return CompletionItemKind.Text;
  }
}
