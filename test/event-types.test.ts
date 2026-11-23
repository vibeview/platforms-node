import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { EVENT_TYPES, type Event, type EventType, type KnownEventType } from '../src/index';

const root = new URL('../', import.meta.url);
const document = JSON.parse(readFileSync(new URL('openapi.json', root), 'utf8')) as {
  components: {
    schemas: { EventOut: { 'x-vibeview-event-types': { type: string; sent: boolean }[] } };
  };
};

/** The TypeScript errors of `code`, compiled against the package source. */
function compile(code: string): string[] {
  const dir = fileURLToPath(new URL('test/', root));
  const file = `${dir}event-types-snippet.ts`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ['lib.es2022.d.ts'],
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    noFallthroughCasesInSwitch: true,
    baseUrl: fileURLToPath(root),
    paths: { '@vibeview/platforms': [fileURLToPath(new URL('src/index.ts', root))] },
  };
  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) => (name === file ? code : readFile(name));
  host.fileExists = (name) => name === file || fileExists(name);
  const program = ts.createProgram([file], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === file)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

/** A switch over an event's type, with a case for each of `types`. */
function switchSource(types: string[]): string {
  const cases = types
    .map((t) => `    case ${JSON.stringify(t)}:\n      return 'known';`)
    .join('\n');
  return `import type { Event, EventType, KnownEventType } from '@vibeview/platforms';

// Exhaustive over the known types: default is reached only by a type this version does not know.
export function handle(event: Event): string {
  const type: EventType = event.type;
  const known = type as KnownEventType;
  switch (known) {
${cases}
    default: {
      const unhandled: never = known;
      void unhandled;
      return 'unknown: ' + type;
    }
  }
}

// default still takes a string no version lists.
export const fromTheFuture: EventType = 'thing.from_the_future';
export const later = handle({ type: 'thing.from_the_future' } as Event);
`;
}

describe('EVENT_TYPES', () => {
  it('is the list the API document publishes, with the same sent flags', () => {
    const listed = document.components.schemas.EventOut['x-vibeview-event-types'];
    const sorted = [...listed].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
    expect(Object.entries(EVENT_TYPES).map(([type, { sent }]) => ({ type, sent }))).toEqual(sorted);
    expect(Object.values(EVENT_TYPES).some((t) => !t.sent)).toBe(true);
    expect(Object.values(EVENT_TYPES).some((t) => t.sent)).toBe(true);
  });

  it('Event.type is EventType: a known type or any other string', () => {
    expectTypeOf<Event['type']>().toEqualTypeOf<EventType>();
    expectTypeOf<KnownEventType>().toExtend<EventType>();
    expectTypeOf<'account.created'>().toExtend<KnownEventType>();
    expectTypeOf<'thing.from_the_future'>().toExtend<EventType>();
  });

  it('a switch with a case for every known type typechecks as exhaustive', () => {
    expect(compile(switchSource(Object.keys(EVENT_TYPES)))).toEqual([]);
  }, 60_000);

  it('a switch missing one known type does not typecheck', () => {
    const missing = compile(switchSource(Object.keys(EVENT_TYPES).slice(1)));
    expect(missing.join('\n')).toMatch(/not assignable to type 'never'/);
  }, 60_000);
});
