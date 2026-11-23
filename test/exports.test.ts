// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build as tsupBuild, type Options } from 'tsup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountsResource, SessionsResource, VibeViewError } from '../src/index';
import { installDependencies } from './install';

// The types and the JavaScript must never disagree: every name the built .d.ts exports as a
// value (without `type`) must exist in every built JavaScript entry, and nothing else.

const root = fileURLToPath(new URL('../', import.meta.url));
let dist = '';

beforeAll(async () => {
  // The package's own tsup config, built into a temporary directory (types included).
  dist = mkdtempSync(join(tmpdir(), 'vv-platforms-exports-'));
  const config = (await import('../tsup.config')).default as Options;
  await tsupBuild({
    ...config,
    entry: (config.entry as string[]).map((entry) => join(root, entry)),
    outDir: dist,
    silent: true,
    tsconfig: join(root, 'tsconfig.json'),
  });
  installDependencies(join(dist, 'node_modules'));
}, 120_000);

afterAll(() => {
  if (dist) rmSync(dist, { recursive: true, force: true });
});

function declared(file: string): { values: string[]; types: string[] } {
  const text = readFileSync(join(dist, file), 'utf8');
  const names = [...text.matchAll(/^export \{([^}]*)\};?$/gm)].flatMap((m) =>
    (m[1] ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean),
  );
  expect(names.length).toBeGreaterThan(20);
  const exported = (n: string) => (n.split(/\s+as\s+/).pop() ?? n).replace(/^type\s+/, '');
  return {
    values: names
      .filter((n) => !n.startsWith('type '))
      .map(exported)
      .sort(),
    types: names
      .filter((n) => n.startsWith('type '))
      .map(exported)
      .sort(),
  };
}

/** The names an esbuild bundle exports, read without running it (the stub throws on load). */
function staticExports(file: string): string[] {
  const text = readFileSync(join(dist, file), 'utf8');
  if (file.endsWith('.cjs')) {
    const block = /__export\(\w+, \{([\s\S]*?)\}\);/.exec(text)?.[1] ?? '';
    return [...block.matchAll(/^\s*(\w+): \(\) =>/gm)].map((m) => m[1] ?? '').sort();
  }
  const block = [...text.matchAll(/^export \{([^}]*)\};?$/gm)].map((m) => m[1] ?? '').join(',');
  return block
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
    .map((n) => n.split(/\s+as\s+/).pop() ?? n)
    .sort();
}

describe('the built package: types and runtime agree', () => {
  it('index.d.ts and index.d.cts declare the same names', () => {
    expect(declared('index.d.cts')).toEqual(declared('index.d.ts'));
  });

  it('every value the types declare exists in index.js and index.cjs, and nothing more', async () => {
    const { values, types } = declared('index.d.ts');
    const esm = Object.keys(await import(pathToFileURL(join(dist, 'index.js')).href)).sort();
    const cjs = Object.keys(createRequire(import.meta.url)(join(dist, 'index.cjs')) as object)
      .filter((n) => n !== '__esModule')
      .sort();
    expect(esm).toEqual(values);
    expect(cjs).toEqual(values);
    for (const name of types) expect(esm).not.toContain(name);
  });

  it('the browser stand-ins export the same values', () => {
    const { values } = declared('index.d.ts');
    expect(staticExports('browser.js')).toEqual(values);
    expect(staticExports('browser.cjs')).toEqual(values);
  });

  it('the resource classes are exported, and cannot be built outside new VibeView()', () => {
    expect(declared('index.d.ts').values).toEqual(
      expect.arrayContaining(['AccountsResource', 'SessionsResource', 'PartnerResource']),
    );
    expect(() => new AccountsResource({} as never)).toThrow(VibeViewError);
    expect(() => new SessionsResource({} as never)).toThrow(/created by new VibeView/);
  });
});
