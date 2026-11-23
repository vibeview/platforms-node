import type { LastResponse } from './types';

/** A list answer of the API (`object: "list"`). */
export interface ListBody {
  data: unknown[];
  has_more: boolean;
}

/** One item of a list answer. */
export type Item<L extends ListBody> = L['data'][number];

/** What the client adds to a list answer (none of it shows in `JSON.stringify`). */
export interface PageMethods<L extends ListBody> extends AsyncIterable<Item<L>> {
  /** `has_more`: whether a next page exists. */
  readonly hasMore: boolean;
  /** The next page (`starting_after` = the last item's id), or null when this is the last. */
  nextPage(): Promise<Page<L>> | null;
  readonly lastResponse: LastResponse;
}

/**
 * One page of a list, exactly as the API sent it, plus `hasMore`, `nextPage()` and
 * iteration over every item of this page and the pages after it (`for await`).
 */
export type Page<L extends ListBody> = L & PageMethods<L>;

/** A list call: await it for the first page, or iterate it for every item. */
export type PagePromise<L extends ListBody> = Promise<Page<L>> & AsyncIterable<Item<L>>;

export function makePage<L extends ListBody>(
  body: L,
  lastResponse: LastResponse,
  fetchAfter: ((startingAfter: string) => Promise<Page<L>>) | null,
): Page<L> {
  const page = body as Page<L>;
  const nextPage = (): Promise<Page<L>> | null => {
    if (!body.has_more || fetchAfter === null || body.data.length === 0) return null;
    const last = body.data[body.data.length - 1] as { id?: unknown };
    if (typeof last?.id !== 'string') return null;
    return fetchAfter(last.id);
  };
  async function* iterate(): AsyncGenerator<Item<L>> {
    let current: Page<L> = page;
    for (;;) {
      yield* current.data as Item<L>[];
      const next = current.nextPage();
      if (next === null) return;
      current = await next;
    }
  }
  Object.defineProperties(page, {
    hasMore: { value: body.has_more === true, enumerable: false },
    nextPage: { value: nextPage, enumerable: false },
    lastResponse: { value: lastResponse, enumerable: false },
    [Symbol.asyncIterator]: { value: iterate, enumerable: false },
  });
  return page;
}

export function makePagePromise<L extends ListBody>(first: Promise<Page<L>>): PagePromise<L> {
  const promise = first as PagePromise<L>;
  Object.defineProperty(promise, Symbol.asyncIterator, {
    enumerable: false,
    value: async function* (): AsyncGenerator<Item<L>> {
      yield* await first;
    },
  });
  return promise;
}
