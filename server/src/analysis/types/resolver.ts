import { Type } from './model';

export class TypeResolver {
  private typedefs = new Map<string, Type>();

  addAlias(name: string, type: Type): void {
    this.typedefs.set(name, type);
  }

  resolve(name: string): Type {
    return this.typedefs.get(name) ?? { tag: 'unknown' };
  }
}
