import {
    Connection,
    TextDocuments
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Analyzer } from '../../analysis/project/graph';
import { getConfiguration } from '../../util/config';
import { areArraysEqual } from '../../util/array';

let currentIncludePaths: string[] = [];

export function registerIncludePaths(conn: Connection, docs: TextDocuments<TextDocument>): void {
    const analyser = Analyzer.instance();

    conn.onDidChangeConfiguration(async () => {
        const config = await getConfiguration(conn);

        const newIncludePaths = Array.isArray(config.includePaths) ? config.includePaths : [];

        if (areArraysEqual(currentIncludePaths, newIncludePaths)) return;

        console.log(`include paths change ${currentIncludePaths} -> ${newIncludePaths}`);
    });
}
