export interface DiagnosticRule {
  id: string;
  check(node: any): boolean;
  message(node: any): string;
}
