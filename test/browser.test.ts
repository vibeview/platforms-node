import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { build as tsupBuild, type Options } from 'tsup';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VibeView, VibeViewError } from '../src/index';
import { KEY, TOKEN } from './helpers';
import { installDependencies } from './install';

const pkgJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
  exports: Record<string, Record<string, { types: string; default: string }>>;
  sideEffects: unknown;
  browser: unknown;
};
const pkg = pkgJson;

function thrown(make: () => unknown): Error {
  try {
    make();
  } catch (error) {
    return error as Error;
  }
  throw new Error('nothing was thrown');
}

describe('server only', () => {
  it('the browser build throws "server-only" when loaded', async () => {
    await expect(import('../src/browser')).rejects.toThrow(/server-only/);
  });

  it('export conditions: workerd resolves the real build, then browsers the refusal', () => {
    const root = pkg.exports['.'] ?? {};
    expect(Object.keys(root)).toEqual(['workerd', 'browser', 'import', 'require']);
    expect(root.workerd?.default).toBe('./dist/index.js');
    expect(root.browser?.default).toBe('./dist/browser.js');
    expect(readFileSync(new URL('../tsup.config.ts', import.meta.url), 'utf8')).toContain(
      "'src/browser.ts'",
    );
  });

  it('bundlers keep the refusal: browser.js is listed as having side effects', () => {
    expect(pkgJson.sideEffects).toEqual(['./dist/browser.js', './dist/browser.cjs']);
    expect(pkgJson.browser).toEqual({
      './dist/index.js': './dist/browser.js',
      './dist/index.cjs': './dist/browser.cjs',
    });
  });
});

describe('a browser bundle of a consumer (esbuild)', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  let dir = '';

  beforeAll(async () => {
    // The package as a consumer installs it: its package.json, and dist built by the
    // package's own tsup config (only the output directory changes, and no .d.ts, which a
    // bundle never reads), so the published files, conditions and sideEffects decide.
    dir = mkdtempSync(join(tmpdir(), 'vv-platforms-bundle-'));
    const pkgDir = join(dir, 'node_modules', '@vibeview', 'platforms');
    cpSync(join(root, 'package.json'), join(pkgDir, 'package.json'), { recursive: true });
    const config = (await import('../tsup.config')).default as Options;
    await tsupBuild({
      ...config,
      entry: (config.entry as string[]).map((entry) => join(root, entry)),
      outDir: join(pkgDir, 'dist'),
      dts: false,
      silent: true,
      tsconfig: join(root, 'tsconfig.json'),
    });
    installDependencies(join(dir, 'node_modules'));
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  async function bundle(name: string, source: string, conditions?: string[]) {
    const entry = join(dir, `${name}.mjs`);
    writeFileSync(entry, source);
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      minify: true,
      write: false,
      absWorkingDir: dir,
      conditions,
      logLevel: 'silent',
    });
    const out = join(dir, `${name}.bundle.mjs`);
    writeFileSync(out, result.outputFiles[0]?.text ?? '');
    return out;
  }

  it.each([
    [
      'a named import',
      "import { VibeView } from '@vibeview/platforms';\nnew VibeView({ apiKey: 'k' });\n",
    ],
    ['a bare import', "import '@vibeview/platforms';\n"],
    [
      'an unused named import',
      "import { APIError } from '@vibeview/platforms';\nexport const x = 1;\n",
    ],
  ])('%s throws "server-only" when the bundle runs', async (name, source) => {
    const out = await bundle(name.replace(/ /g, '-'), source);
    expect(readFileSync(out, 'utf8')).toContain('server-only');
    await expect(import(pathToFileURL(out).href)).rejects.toThrow(/server-only/);
  });

  it('a browser Web Worker bundle (webpack and esbuild set "worker") gets the refusal', async () => {
    const out = await bundle(
      'web-worker',
      "import { VibeView } from '@vibeview/platforms';\nnew VibeView({ apiKey: 'k' });\n",
      ['worker', 'browser'],
    );
    await expect(import(pathToFileURL(out).href)).rejects.toThrow(/server-only/);
  });

  it('a bundle with the workerd condition gets the real build, webhook verification included', async () => {
    const out = await bundle(
      'worker',
      "import { VibeView } from '@vibeview/platforms';\nexport const version = VibeView.VERSION;\n" +
        'export const verify = VibeView.webhooks.verify;\n',
      ['workerd', 'browser'],
    );
    const module = (await import(pathToFileURL(out).href)) as {
      version: string;
      verify: unknown;
    };
    expect(module.version).toBe(pkgJson.version);
    expect(typeof module.verify).toBe('function');
  });
});

describe('credentials', () => {
  it('needs exactly one of apiKey and accessToken', () => {
    for (const options of [{}, { apiKey: KEY, accessToken: TOKEN }]) {
      const error = thrown(() => new VibeView(options));
      expect(error).toBeInstanceOf(VibeViewError);
      expect(error.message).toMatch(/apiKey/);
      expect(error.message).toMatch(/accessToken/);
    }
  });

  it('an access token given as apiKey names both options and prints no secret', () => {
    const error = thrown(() => new VibeView({ apiKey: TOKEN }));
    expect(error.message).toMatch(/apiKey/);
    expect(error.message).toMatch(/accessToken/);
    expect(error.message).not.toContain(TOKEN);
    expect(error.message).not.toContain('y'.repeat(8));
  });

  it('a partner key given as accessToken names both options and prints no secret', () => {
    const error = thrown(() => new VibeView({ accessToken: KEY }));
    expect(error.message).toMatch(/apiKey/);
    expect(error.message).toMatch(/accessToken/);
    expect(error.message).not.toContain(KEY);
    expect(error.message).not.toContain('x'.repeat(8));
  });

  it('refuses a value that is not a credential, naming the option', () => {
    expect(thrown(() => new VibeView({ apiKey: 'sk_live_abc' })).message).toMatch(/apiKey option/);
    expect(thrown(() => new VibeView({ accessToken: 'abc' })).message).toMatch(
      /accessToken option/,
    );
  });
});

describe('other options', () => {
  it('refuses a plain-http base URL off this machine', () => {
    expect(
      thrown(() => new VibeView({ apiKey: KEY, baseUrl: 'http://example.com/api/v1' })).message,
    ).toMatch(/baseUrl option/);
    expect(() => new VibeView({ apiKey: KEY, baseUrl: 'http://127.0.0.1:9/api/v1' })).not.toThrow();
    for (const baseUrl of [
      'ftp://example.com/api/v1',
      'https://user:pass@example.com/api/v1',
      'https://example.com/api/v1?x=1',
      'https://example.com/api/v1?',
      'https://example.com/api/v1#x',
      'not a url',
    ]) {
      expect(thrown(() => new VibeView({ apiKey: KEY, baseUrl })).message).toMatch(
        /baseUrl option/,
      );
      expect(thrown(() => new VibeView({ apiKey: KEY, baseUrl })).message).not.toContain(baseUrl);
    }
    expect(
      () => new VibeView({ apiKey: KEY, baseUrl: 'https://example.com/api/v1/' }),
    ).not.toThrow();
  });

  it.each([
    [{ maxRetries: -1 }, /maxRetries option/],
    [{ maxRetries: 1.5 }, /maxRetries option/],
    [{ maxRetries: 11 }, /maxRetries option/],
    [{ timeoutMs: 0 }, /timeoutMs option/],
    [{ partner: '' }, /partner option/],
    [{ account: 'org with space' }, /account option/],
    [{ account: 'org_é' }, /account option/],
    [{ fetch: 'no' as unknown as typeof fetch }, /fetch option/],
  ])('refuses %o', (options, message) => {
    expect(thrown(() => new VibeView({ apiKey: KEY, ...options })).message).toMatch(message);
  });
});
