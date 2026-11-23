import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VibeView } from '../src/index';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  exports: Record<string, string | Record<string, Record<string, string>>>;
  files: string[];
  dependencies?: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
  scripts: Record<string, string>;
};

describe('package.json', () => {
  it('VibeView.VERSION is the package version', () => {
    expect(VibeView.VERSION).toBe(pkg.version);
  });

  it('lists types first in every export condition', () => {
    const root = pkg.exports['.'] as Record<string, Record<string, string>>;
    for (const condition of Object.values(root)) {
      expect(Object.keys(condition)[0]).toBe('types');
    }
  });

  it('publishes only the build, the README, the changelog and the licence', () => {
    expect(pkg.files).toEqual(['dist', 'README.md', 'CHANGELOG.md', 'LICENSE']);
  });

  it('has one runtime dependency (standardwebhooks) and pins every dependency', () => {
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['standardwebhooks']);
    for (const version of Object.values(pkg.dependencies ?? {}))
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const version of Object.values(pkg.devDependencies))
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.engines.node).toBe('>=20');
  });

  it('the build script empties dist before tsup runs', () => {
    expect(pkg.scripts.build).toMatch(/rmSync\('dist'.*&& tsup$/);
  });
});
