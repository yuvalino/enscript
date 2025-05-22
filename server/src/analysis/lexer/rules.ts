// Simplified rules – split on whitespace & punctuation, recognise keywords.
export const keywords = new Set([
  'class', 'enum', 'typedef', 'using', 'extends', 'auto', 'void', 'bool',
  'int', 'float', 'string', 'vector', 'modded', 'proto', 'native', 'owned',
  'ref', 'return', 'if', 'else', 'for', 'while', 'break', 'continue', 'out',
  'override', 'private', 'protected', 'public', 'static', 'const'
]);

export const punct = '(){}[];:,.<>=';
