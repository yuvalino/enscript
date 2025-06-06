import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const serverModule = path.join(__dirname, '..', 'server', 'out', 'index.js');

    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };

    const serverOptions: ServerOptions = {
        run:   { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ language: 'enscript' }],
        synchronize: {
            configurationSection: 'enscript',
            fileEvents: vscode.workspace.createFileSystemWatcher('**/*.c'),
        },
        initializationOptions: {
            includePaths: vscode.workspace.getConfiguration('enscript').get<string[]>('includePaths') || []
        },
    };

    client = new LanguageClient(
        'EnscriptLS',
        'Enscript Language Server',
        serverOptions,
        clientOptions
    );
    client.start();
    context.subscriptions.push(client);

    context.subscriptions.push(
        vscode.commands.registerCommand('enscript.restartServer', () => client?.restart())
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('enscript.dumpDiagnostics', async () => {
        const response = await client?.sendRequest('enscript/dumpDiagnostics');

        if (!response) {
            vscode.window.showInformationMessage('No diagnostics returned.');
            return;
        }

        const json = JSON.stringify(response, null, 4); // Pretty-print with 4 spaces

        const doc = await vscode.workspace.openTextDocument({
            language: 'json',
            content: json
        });

        await vscode.window.showTextDocument(doc);
    })
    )
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}
