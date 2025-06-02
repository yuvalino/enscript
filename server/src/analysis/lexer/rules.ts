// Simplified rules – split on whitespace & punctuation, recognise keywords.
export const keywords = new Set([
  'class', 'enum', 'typedef', 'using', 'extends', 'auto', 'event',
  'modded', 'proto', 'native', 'owned', 'local',
  'ref', 'reference', 'return', 'if', 'else', 'for', 'while', 'break', 'continue', 'out', 'inout',
  'override', 'private', 'protected', 'public', 'static', 'const', 'notnull', 'external', 'volatile', 'autoptr'
]);

export const punct = '(){}[];:,.<>=';
