export type ScopeKind = 'global' | 'class' | 'function' | 'block' | 'enum';

export interface SymbolEntry {
  name: string;
  kind: 'class' | 'enum' | 'function' | 'field' | 'variable' | 'parameter';
  type?: string;
  uri: string;
  start: number;
  end: number;
}

export class Scope {
  public symbols = new Map<string, SymbolEntry[]>();
  public children: Scope[] = [];
  constructor(public kind: ScopeKind, public parent?: Scope) {}

  declare(sym: SymbolEntry): void {
    if (!this.symbols.has(sym.name)) this.symbols.set(sym.name, []);
    this.symbols.get(sym.name)!.push(sym);
  }

  lookup(name: string): SymbolEntry | undefined {
    for (let s: Scope | undefined = this; s; s = s.parent) {
      const list = s.symbols.get(name);
      if (list && list.length) return list[0];
    }
    return undefined;
  }
}
