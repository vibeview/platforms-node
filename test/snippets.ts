import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = new URL('../', import.meta.url);

/** The code of every fenced block whose info string is exactly `info` (```ts, ```ts sdk). */
export function fencedBlocks(markdown: string, info: string): string[] {
  if (!/^[a-z ]+$/.test(info)) throw new Error(`not an info string: ${info}`);
  const fence = new RegExp('^```' + info + '\\n([\\s\\S]*?)^```', 'gm');
  return [...markdown.matchAll(fence)].map((m) => m[1] ?? '');
}

/**
 * Type-checks each snippet as its own module against the package source (`@vibeview/platforms`
 * resolves to `src/index.ts`), strict, with Node's types. Returns one line per problem
 * (`<name>:<line> <message>`); an empty list means every snippet compiles.
 */
export function compileSnippets(snippets: Map<string, string>): string[] {
  const entry = fileURLToPath(new URL('src/index.ts', root));
  const dir = fileURLToPath(new URL('test/', root));
  const files = new Map([...snippets].map(([name, code]) => [`${dir}${name}.ts`, code]));
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts'],
    types: ['node'],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    baseUrl: fileURLToPath(root),
    paths: { '@vibeview/platforms': [entry] },
    typeRoots: [
      fileURLToPath(new URL('node_modules/@types', root)),
      fileURLToPath(new URL('../node_modules/@types', root)),
    ],
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) => files.get(name) ?? readFile(name);
  host.fileExists = (name) => files.has(name) || fileExists(name);
  const program = ts.createProgram([...files.keys()], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file === undefined || files.has(d.file.fileName))
    .map((d) => {
      const where = d.file
        ? `${d.file.fileName.slice(dir.length)}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}`
        : '';
      return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`;
    });
}
