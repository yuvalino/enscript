import { URI } from 'vscode-uri';

export function normalizeUri(uri: string): string {
    return URI.parse(uri).toString();
}