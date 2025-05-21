import { File } from './parser';

export function prettyPrint(ast: File): string {
  return JSON.stringify(ast, null, 2);
}
