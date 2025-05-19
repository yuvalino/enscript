import { TextDocument } from 'vscode-languageserver-textdocument';
import { Position, Range, SymbolInformation, SymbolKind, Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { parse, ParseError } from '../ast/parser';
import { prettyPrint } from '../ast/printer';
import { FileNode } from '../ast/nodes';
import * as url from 'node:url';

/** Singleton façade that lazily analyses files and answers LSP queries. */
export class Analyzer {
  private static _instance: Analyzer;
  static instance(): Analyzer {
    if (!Analyzer._instance) Analyzer._instance = new Analyzer();
    return Analyzer._instance;
  }

  private docCache = new Map<string, ReturnType<typeof parse>>();

  private ensure(doc: TextDocument): FileNode {
    // 1 · cache hit
    if (this.docCache.has(doc.uri)) {
        return this.docCache.get(doc.uri)!;
    }

    try {
        // 2 · happy path ─ parse & cache
        const ast = parse(doc);           // pass full TextDocument
        this.docCache.set(doc.uri, ast);
        return ast;
    } catch (err) {
        // 3 · graceful error handling
        if (err instanceof ParseError) {
            // VS Code recognises “path:line:col” as a jump-to link
            const fsPath = url.fileURLToPath(err.uri);          // file:/// → p:\foo\bar.c
            console.error(`${fsPath}:${err.line}:${err.column}  ${err.message}`);

            // // also publish a real diagnostic so the Problems panel shows it
            // const diagnostic: Diagnostic = {
            //     message: err.message,
            //     range: {
            //         start: { line: err.line - 1, character: err.column - 1 },
            //         end:   { line: err.line - 1, character: err.column     }
            //     },
            //     severity: DiagnosticSeverity.Error,
            //     source:   'parser'
            // };
            // connection.sendDiagnostics({ uri: err.uri, diagnostics: [diagnostic] });
            console.error(String(err.stack));
        } else {
            // unexpected failure
            console.error(String(err));
        }

        // 4 · return an empty stub so callers can continue
        return { kind: 'File', start: 0, end: 0, body: [] };
    }
}

  getCompletions(doc: TextDocument, _pos: Position) {
    const ast = this.ensure(doc);
    return ast.body.filter((n: any) => n.name);
  }

  resolveDefinition(doc: TextDocument, _pos: Position) {
    return null;
  }

  getHover(doc: TextDocument, _pos: Position): string | null {
    const ast = this.ensure(doc);
    const names = ast.body.filter((n: any) => n.name).map((n: any) => n.name);
    return names.length ? 'Symbols: ' + names.join(', ') : null;
  }

  findReferences(doc: TextDocument, _pos: Position, _inc: boolean) {
    return [];
  }

  prepareRename(doc: TextDocument, _pos: Position): Range | null {
    return null;
  }

  renameSymbol(doc: TextDocument, _pos: Position, _newName: string) {
    return [] as { uri: string; range: Range }[];
  }

  getWorkspaceSymbols(): SymbolInformation[] {
    const res: SymbolInformation[] = [];
    for (const [uri, ast] of this.docCache) {
      for (const node of (ast.body as any[])) {
        if (!node.name) continue;
        res.push({
          name: node.name,
          kind: SymbolKind.Class,
          location: { uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }
        });
      }
    }
    return res;
  }

  runDiagnostics(doc: TextDocument) {
    const ast = this.ensure(doc);
    const diags = [] as any[];
    for (const node of (ast.body as any[])) {
      if (node.kind === 'Typedef') {
        diags.push({
          message: `Typedef '${node.newName}' is never used`,
          range: { start: doc.positionAt(node.start), end: doc.positionAt(node.end) },
          severity: 2
        });
      }
    }
    return diags;
  }
}
