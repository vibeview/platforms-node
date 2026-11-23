import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Every type a public method takes or returns must be nameable from the package's exports:
// the server's model names (the generated `components`, `operations`, `paths`) are not part
// of the package's API, so a signature must never need them.

const root = new URL('../', import.meta.url);
// Types every runtime the package supports provides.
const BUILT_INS = new Set(['Promise', 'Uint8Array']);
const entry = fileURLToPath(new URL('src/index.ts', root));

function program() {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts'],
    types: ['node'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  };
  return ts.createProgram([entry], options);
}

describe('exported types', () => {
  const p = program();
  const checker = p.getTypeChecker();
  const source = p.getSourceFile(entry);
  const module = source && checker.getSymbolAtLocation(source);
  const exported = module ? checker.getExportsOfModule(module) : [];
  const names = new Set(exported.map((s) => s.getName()));

  it('the generated document types are not exported', () => {
    for (const name of ['components', 'operations', 'paths', 'Ok', 'Body', 'Query']) {
      expect(names.has(name), name).toBe(false);
    }
  });

  it('every public method signature names only exported types', () => {
    // Read the signatures as written: every type a parameter or the return names must be
    // exported by the package (or be a built-in such as Promise or Uint8Array).
    const problems: string[] = [];
    let methods = 0;
    for (const symbol of exported) {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (!(target.flags & ts.SymbolFlags.Class)) continue;
      for (const declaration of target.declarations ?? []) {
        if (!ts.isClassDeclaration(declaration)) continue;
        for (const member of declaration.members) {
          if (
            !ts.isMethodDeclaration(member) ||
            !member.name ||
            ts.isPrivateIdentifier(member.name)
          ) {
            continue;
          }
          if (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private) continue;
          methods += 1;
          const where = `${target.getName()}.${member.name.getText()}`;
          const typeNodes = [...member.parameters.map((p) => p.type), member.type];
          if (typeNodes.some((node) => node === undefined)) {
            problems.push(`${where}: a parameter or the return has no written type`);
          }
          const visit = (node: ts.Node): void => {
            if (ts.isTypeReferenceNode(node)) {
              const name = node.typeName.getText();
              if (!BUILT_INS.has(name) && !names.has(name)) problems.push(`${where}: ${name}`);
            }
            ts.forEachChild(node, visit);
          };
          for (const node of typeNodes) if (node) visit(node);
        }
      }
    }
    expect(methods).toBeGreaterThan(30);
    expect(problems).toEqual([]);
  });
});
