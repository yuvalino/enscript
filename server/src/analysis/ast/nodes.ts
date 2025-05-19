export type NodeKind =
  | 'File'
  | 'ClassDecl'
  | 'EnumDecl'
  | 'Typedef'
  | 'FunctionDecl'
  | 'VarDecl';

export interface NodeBase {
  kind: NodeKind;
  start: number;
  end: number;
}

export interface FileNode extends NodeBase {
  kind: 'File';
  body: NodeBase[];
}

export interface ClassDeclNode extends NodeBase {
  kind: 'ClassDecl';
  name: string;
  base?: string;
  members: NodeBase[];
}

export interface EnumDeclNode extends NodeBase {
  kind: 'EnumDecl';
  name: string;
  members: string[];
}

export interface TypedefNode extends NodeBase {
  kind: 'Typedef';
  oldType: string;
  newName: string;
}

export interface FunctionDeclNode extends NodeBase {
  kind: 'FunctionDecl';
  name: string;
  parameters: string[];
  returnType: string;
}

export interface VarDeclNode extends NodeBase {
  kind: 'VarDecl';
  name: string;
  type: string;
}
