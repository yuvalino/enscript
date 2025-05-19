import { FileNode } from './nodes';

export function prettyPrint(ast: FileNode): string {
  return JSON.stringify(ast, null, 2);
}
