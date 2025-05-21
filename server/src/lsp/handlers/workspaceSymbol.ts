import { Connection, SymbolInformation, WorkspaceSymbolParams, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';

export function registerWorkspaceSymbol(conn: Connection, _docs: TextDocuments<TextDocument>): void {
    conn.onWorkspaceSymbol((_params: WorkspaceSymbolParams): SymbolInformation[] => {
        const analyser = Analyzer.instance();
        return analyser.getWorkspaceSymbols();
    });
}
