export enum TokenKind {
  Identifier,
  Keyword,
  Number,
  String,
  Operator,
  Punctuation,
  Comment,
  Preproc,
  EOF
}

export interface Token {
  kind: TokenKind;
  value: string;
  start: number;
  end: number;
}
