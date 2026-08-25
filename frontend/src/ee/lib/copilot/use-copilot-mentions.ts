/**
 * The one place that says what `@` can reach.
 *
 * Two composers offer mentions — the editor rail (scoped to the open project)
 * and the home dock (no project, so the user's whole library). They used to
 * each fetch their own lists and hand the picker one prop per kind, which is
 * exactly how `@` came to cover characters and locations while the library had
 * four kinds. One hook: a new kind is a fetcher and an entry, and both surfaces
 * get it.
 *
 * Two families, deliberately kept apart here and joined only at the end:
 * ENTITIES are saved things with their own studios, and their id goes on the
 * node that owns it; FILES are media, and their id goes into `assetId` on an
 * upload node for the server to resolve. Same journey to the model — a name and
 * an id, never an address — but different destinations.
 */
import { useMemo } from "react"
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

/** How many recent files `@` offers before the user has to narrow by typing. */
const MEDIA_PAGE = 40

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
  projectId: string | undefined,
  userId: string | undefined,
): { mentions: CopilotMention[]; loading: boolean } {
  // Typed as a Record so a new entity kind is a compile error here too, not a
  // silent undefined at `entities[kind]`.
  const entities: Record<EntityNodeKind, { data?: EntityRow[]; isLoading: boolean }> = {
    character: useCharacters(projectId, userId),
    object: useObjects(projectId, userId),
    creature: useCreatures(projectId, userId),
    location: useLocations(projectId, userId),
  }

  // Files are not project-scoped: a library belongs to the person, not to the
  // flow they happen to have open.
  const library = useLibraryInfinite({ userId, owned: true, limit: MEDIA_PAGE })

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

    return { mentions, loading: [...entityLoading, libraryLoading].some(Boolean) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...entityLists, ...entityLoading, libraryPages, libraryLoading])
}
