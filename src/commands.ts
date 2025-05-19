import * as vscode from 'vscode';

export function registerUICommands(ctx: vscode.ExtensionContext, restart: () => void) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('enscript.restartServer', restart)
  );
}
