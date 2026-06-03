import type { InfiniteData } from "@tanstack/react-query"

/**
 * Helpers for applying optimistic updates to `useInfiniteQuery` caches.
 *
 * Infinite lists (gallery, library) store each page as an object holding an
 * array of items under a known field (e.g. `"data"`). These helpers map/filter
 * that array immutably across every page so an optimistic update (delete)
 * reflects instantly, while the caller keeps the original snapshot for rollback
 * on error.
 *
 * Never mutates: a new `InfiniteData`, a new `pages` array, new page objects,
 * and a new item array are returned. `pageParams` is preserved by reference.
 */

type PageWithArray<K extends string, T> = { [P in K]: T[] }

/** Map matching items in every page of an infinite query, immutably. */
export function patchInfiniteItems<
  K extends string,
  T,
  Page extends PageWithArray<K, T>,
>(
  data: InfiniteData<Page> | undefined,
  field: K,
  matches: (item: T) => boolean,
  update: (item: T) => T,
): InfiniteData<Page> | undefined {
  if (!data) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      [field]: (page[field] as T[]).map((item) =>
        matches(item) ? update(item) : item,
      ),
    })),
  }
}

/** Remove matching items from every page of an infinite query, immutably. */
export function removeInfiniteItems<
  K extends string,
  T,
  Page extends PageWithArray<K, T>,
>(
  data: InfiniteData<Page> | undefined,
  field: K,
  matches: (item: T) => boolean,
): InfiniteData<Page> | undefined {
  if (!data) return data
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      [field]: (page[field] as T[]).filter((item) => !matches(item)),
    })),
  }
}
