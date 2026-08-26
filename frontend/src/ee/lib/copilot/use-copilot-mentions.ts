/**
 * The one place that says what `@` can reach.
 *
 * Two composers offer mentions — the editor rail and the home dock. They used
 * to each fetch their own lists and hand the picker one prop per kind, which is
 * exactly how `@` came to cover characters and locations while the library had
 * four kinds. One hook: a new kind is a fetcher and an entry, and both surfaces
 * get it.
 *
 * THE WHOLE LIBRARY, never one project. The editor rail used to scope its
 * lists to the open project, and the owner found it with 100 characters saved
 * and 14 offered: everything he had made elsewhere was unreachable through
 * `@`, with no filter to widen. Three things say the scoping was wrong. My
 * Library asks for every project and filters client-side, defaulting to all.
 * The home dock has no project and always asked for everything. And the
 * copilot's own entity tools are USER-scoped — so the MODEL could already see
 * all 100 while the person choosing could not, which is backwards.
 *
 * The parameter is GONE rather than defaulted, so nobody can re-narrow this by
 * passing a project id: the picker has tabs, counts and a search that reaches
 * across them, which is what makes a whole library navigable.
 *
 * Two families, deliberately kept apart here and joined only at the end:
 * ENTITIES are saved things with their own studios, and their id goes on the
 * node that owns it; FILES are media, and their id goes into `assetId` on an
 * upload node for the server to resolve. Same journey to the model — a name and
 * an id, never an address — but different destinations.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useCharacters, useCreatures, useLibraryInfinite, useLocations, useObjects } from "@/hooks/queries/use-assets-queries"
import { characterMentionVariants, toMentions } from "./mentions"
import { MEDIA_MENTION_KINDS, MENTION_KINDS, type CopilotMention, type MediaMentionKind } from "./types"
import { ENTITY_NODE_KINDS, type EntityNodeKind } from "@nodaro/shared"

/** What every entity list hook resolves to, as far as a mention cares. */
interface EntityRow {
  id: string
  name: string
  sourceImageUrl?: string | null
}

/** What the library returns, as far as a mention cares. */
interface LibraryRow {
  id: string
  type: MediaMentionKind | string
  filename: string
  thumbnailUrl?: string | null
  url?: string
}

/**
 * Files fetched per page. Unlike the entity lists — which are drained whole,
 * because a library holds hundreds of characters, not thousands — files are
 * paged and SEARCHED ON THE SERVER.
 *
 * The difference is the size of the thing. Draining a five-thousand-file
 * library on every `@` would be a bad trade for a dropdown; leaving the
 * newest 40 and filtering them in the browser was a worse one, because a
 * search that only sees 40 rows answers "no match" about a file the user
 * owns and can see in My Library.
 */
const MEDIA_PAGE = 40

/** Typing pause before a search reaches the server. */
const SEARCH_DEBOUNCE_MS = 250

/**
 * Trails `value` by `delayMs`, so a search fires once the user stops typing
 * rather than once per keystroke.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return settled
}

/**
 * Every entity and file the user can mention, in picker order.
 *
 * `loading` means ANY list is still in flight. The picker pairs it with "the
 * catalogue is empty" to decide between "looking" and "you have none", so a
 * settled-empty characters list must not out-vote a library that has not
 * answered yet — that is how a user with fifty files gets told they have
 * nothing.
 */
export function useCopilotMentions(
  userId: string | undefined,
  /**
   * What the user is typing to narrow the list — the `@query` in the composer,
   * or the full-size browser's own search box.
   *
   * ENTITIES ignore it: they are all in memory, and filtering them in the
   * browser is instant and exact. FILES use it as a server query, because
   * they are paged and the newest 40 are not the library.
   */
  search = "",
): {
  mentions: CopilotMention[]
  loading: boolean
  fileTotal: number | null
  hasMoreFiles: boolean
  loadMoreFiles: () => void
} {
  // Typed as a Record so a new entity kind is a compile error here too, not a
  // silent undefined at `entities[kind]`.
  //
  // `undefined` project on every one of them: see the header. An entity the
  // user saved is theirs wherever they made it.
  const entities: Record<EntityNodeKind, { data?: EntityRow[]; isLoading: boolean }> = {
    character: useCharacters(undefined, userId),
    object: useObjects(undefined, userId),
    creature: useCreatures(undefined, userId),
    location: useLocations(undefined, userId),
  }

  // Files are not project-scoped: a library belongs to the person, not to the
  // flow they happen to have open.
  //
  // The trimmed, debounced search goes to the SERVER, which matches the same
  // filename field the browser-side filter does — so the two agree and the
  // local pass over the results is a no-op rather than a second, narrower
  // filter.
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS)
  const library = useLibraryInfinite({
    userId,
    owned: true,
    limit: MEDIA_PAGE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  })
  /**
   * How many files actually match — the server's exact count, not how many
   * arrived. The tab used to show the loaded count, which read as "you have
   * 40 files" to someone with five hundred.
   */
  const fileTotal = library.data?.pages[0]?.totalCount ?? null

  /**
   * Pull the next page of files.
   *
   * Search alone is not enough: a broad one ("img") can match hundreds, and a
   * count saying 120 beside 40 rows is honest but useless if the other 80 are
   * unreachable. Guarded on `isFetchingNextPage` because the scroll handler
   * that calls this fires on every frame of a flick.
   */
  const hasMoreFiles = Boolean(library.hasNextPage)
  const fetchNextPage = library.fetchNextPage
  const isFetchingNextPage = library.isFetchingNextPage
  const loadMoreFiles = useCallback(() => {
    if (!hasMoreFiles || isFetchingNextPage) return
    void fetchNextPage()
  }, [hasMoreFiles, isFetchingNextPage, fetchNextPage])

  const entityLists = ENTITY_NODE_KINDS.map((kind) => entities[kind].data)
  const entityLoading = ENTITY_NODE_KINDS.map((kind) => entities[kind].isLoading)
  const libraryPages = library.data?.pages
  const libraryLoading = library.isLoading

  return useMemo(() => {
    const entityMentions = ENTITY_NODE_KINDS.flatMap((kind, i) => {
      const base = toMentions(entityLists[i], kind)
      if (kind !== "character") return base
      // The characters LIST already carries every variant bucket (same mapper
      // as the detail route), so the picker's drill-in costs zero fetches —
      // reshape it onto the mention here.
      const rows = (entityLists[i] ?? []) as unknown as Array<Record<string, unknown>>
      const byId = new Map(rows.map((row) => [String(row.id), row]))
      return base.map((mention) => {
        const row = byId.get(mention.id)
        const variants = row ? characterMentionVariants(row) : []
        return variants.length > 0 ? { ...mention, variants } : mention
      })
    })

    const files: CopilotMention[] = []
    for (const page of libraryPages ?? []) {
      for (const row of (page as { data?: LibraryRow[] }).data ?? []) {
        // The library also holds documents; only what a node can take is
        // offered, and the row's own type is what decides — not a guess from
        // the filename.
        const kind = MEDIA_MENTION_KINDS.find((k) => k === row.type)
        if (!kind) continue
        files.push({
          id: row.id,
          name: row.filename,
          kind,
          imageUrl: row.thumbnailUrl ?? (kind === "image" ? (row.url ?? null) : null),
        })
      }
    }

    // MENTION_KINDS order, so the picker's sections and this agree.
    const order = new Map(MENTION_KINDS.map((kind, i) => [kind, i]))
    const mentions = [...entityMentions, ...files].sort(
      (a, b) => (order.get(a.kind) ?? 0) - (order.get(b.kind) ?? 0),
    )

    return {
      mentions,
      loading: [...entityLoading, libraryLoading].some(Boolean),
      fileTotal,
      hasMoreFiles,
      loadMoreFiles,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...entityLists, ...entityLoading, libraryPages, libraryLoading, fileTotal, hasMoreFiles, loadMoreFiles])
}
