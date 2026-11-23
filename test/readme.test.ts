import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileSnippets, fencedBlocks } from './snippets';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const snippets = fencedBlocks(readme, 'ts');

describe('README', () => {
  it('has TypeScript snippets', () => {
    expect(snippets.length).toBeGreaterThanOrEqual(4);
  });

  it('every ts snippet compiles against the package source', () => {
    const files = new Map(snippets.map((code, i) => [`readme-snippet-${i}`, code]));
    expect(compileSnippets(files)).toEqual([]);
  }, 60_000);
});
