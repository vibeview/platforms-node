import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileSnippets } from './snippets';

interface Generator {
  render(): Promise<{ api: string; errorCodes: string; eventTypes: string }>;
}

describe('src/generated', () => {
  it('regenerating from openapi.json gives the committed files byte for byte', async () => {
    const generator = new URL('../scripts/generate.mjs', import.meta.url).href;
    const { render } = (await import(generator)) as Generator;
    const { api, errorCodes, eventTypes } = await render();
    const committed = (file: string) =>
      readFileSync(new URL(`../src/generated/${file}`, import.meta.url), 'utf8');
    expect(api === committed('api.ts'), 'run `npm run generate`').toBe(true);
    expect(errorCodes === committed('error-codes.ts'), 'run `npm run generate`').toBe(true);
    expect(eventTypes === committed('event-types.ts'), 'run `npm run generate`').toBe(true);
  }, 30_000);

  it('a free-form object of the document takes members (an open record, never an empty one)', () => {
    const api = readFileSync(new URL('../src/generated/api.ts', import.meta.url), 'utf8');
    const members = api.split('\n').filter((line) => /^\s+.*Record<string, never>/.test(line));
    expect(members).toEqual([]);
    const use = [
      "import { VibeView } from '@vibeview/platforms';",
      "const vibeview = new VibeView({ apiKey: 'vvp_test_x' });",
      "const customer = vibeview.withAccount('org_x');",
      "await vibeview.accounts.create({ external_ref: 'r', limits: { concurrent_sessions: 2 } });",
      "await vibeview.accounts.update('org_x', { limits: { concurrent_sessions: 2 } });",
      "await customer.sessions.launchApp('s', { package_name: 'com.example', launch_params: { screen: 'home' } });",
      "await customer.sessions.runAgentTool('s', { tool: 'tap', args: { ref: '@e11' } });",
    ].join('\n');
    expect(compileSnippets(new Map([['generated-open-objects', use]]))).toEqual([]);
  }, 60_000);
});
