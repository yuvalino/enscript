import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';
import { registerUICommands } from './commands';

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
      fileEvents: vscode.workspace.createFileSystemWatcher('**/*.c')
    }
  };

  client = new LanguageClient(
    'EnscriptLS',
    'Enscript Language Server',
    serverOptions,
    clientOptions
  );
  client.start();
  context.subscriptions.push(client);
  registerUICommands(context, () => client?.restart());
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
