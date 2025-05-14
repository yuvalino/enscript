import { TextDocument } from 'vscode-languageserver-textdocument';
import { Location, Range } from 'vscode-languageserver/node';

export function parseSymbols(
    doc: TextDocument
): { name: string; location: Location }[] {
    const text = doc.getText();
    const symbols = [];
    const lines = text.split(/\r?\n/g);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const classMatch = line.match(/class\s+(\w+)/);
        const funcMatch = line.match(
            /(?:void|bool|int|float|string|proto\s+\w+)\s+(\w+)\s*\(/
        );

        if (classMatch) {
            const name = classMatch[1];
            symbols.push({
                name,
                location: Location.create(
                    doc.uri,
                    Range.create(i, 0, i, name.length)
                )
            });
        }

        if (funcMatch) {
            const name = funcMatch[1];
            symbols.push({
                name,
                location: Location.create(
                    doc.uri,
                    Range.create(i, 0, i, name.length)
                )
            });
        }
    }

    return symbols;
}
