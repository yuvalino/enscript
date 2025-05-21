import {
  Connection,
  Diagnostic,
  DiagnosticSeverity,
  TextDocumentChangeEvent,
  TextDocuments
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';

export function registerDocuments(conn: Connection, docs: TextDocuments<TextDocument>): void {
    const analyser = Analyzer.instance();

    const validate = (change: TextDocumentChangeEvent<TextDocument>) => {
        const diagnostics = analyser.runDiagnostics(change.document);
        conn.sendDiagnostics({ uri: change.document.uri, diagnostics });
    };

    docs.onDidOpen(validate);
    docs.onDidSave(validate);
    docs.onDidChangeContent(validate);
}
