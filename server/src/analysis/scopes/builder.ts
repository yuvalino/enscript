import { File, NodeBase } from '../ast/parser';
import { Scope, SymbolEntry } from './scope';

export function buildScopes(ast: File, uri: string): Scope {
  const global = new Scope('global');

  function visit(node: NodeBase, scope: Scope) {
    switch (node.kind) {
      case 'ClassDecl':
        scope.declare(makeSym(node as any, 'class'));
        scope.children.push(new Scope('class', scope));
        break;
      case 'EnumDecl':
        scope.declare(makeSym(node as any, 'enum'));
        break;
      case 'FunctionDecl':
        scope.declare(makeSym(node as any, 'function'));
        scope.children.push(new Scope('function', scope));
        break;
      case 'VarDecl':
        scope.declare(makeSym(node as any, 'variable'));
        break;
    }
  }

  function makeSym(node: any, kind: SymbolEntry['kind']): SymbolEntry {
    return { name: node.name, kind, uri, start: node.start, end: node.end };
  }

  for (const top of ast.body) visit(top, global);
  return global;
}
