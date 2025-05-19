import * as fs from 'node:fs/promises';

export async function readFileUtf8(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}
