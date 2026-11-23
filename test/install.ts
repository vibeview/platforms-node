import { cpSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Copies the package's runtime dependencies (and theirs) into `nodeModules`, as an install
 * would, so a build in a temporary directory resolves them.
 */
export function installDependencies(nodeModules: string): void {
  const manifest = new URL('../package.json', import.meta.url);
  const pending: [string, string][] = Object.keys(
    (JSON.parse(readFileSync(manifest, 'utf8')) as { dependencies?: Record<string, string> })
      .dependencies ?? {},
  ).map((name) => [name, manifest.pathname]);
  while (pending.length > 0) {
    const [name, from] = pending.pop() as [string, string];
    const target = join(nodeModules, name);
    if (existsSync(target)) continue;
    const pkgJson = createRequire(from).resolve(`${name}/package.json`);
    cpSync(dirname(pkgJson), target, { recursive: true });
    const deps = (JSON.parse(readFileSync(pkgJson, 'utf8')) as { dependencies?: object })
      .dependencies;
    for (const dep of Object.keys(deps ?? {})) pending.push([dep, pkgJson]);
  }
}
