import {
    Connection,
    TextDocuments
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';

export function registerDumpDiagnostics(conn: Connection, docs: TextDocuments<TextDocument>): void {
    const analyser = Analyzer.instance();

    conn.onRequest('enscript/dumpDiagnostics', async () => {
        return analyser.dumpDiagnostics();
    });
}
