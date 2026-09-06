import { toConnectedReference } from "@nodaro/shared"
import type { MentionCandidate } from "@nodaro/studio-production"

import { entityOwnerFilter } from "../mcp/tools/_entity-scope.js"
import { supabase } from "../supabase.js"

/**
 * The caller's LIBRARY, as the plan importer wants it.
 *
 * A plan names its cast by display name (`@Kira`, `@The old lighthouse`); the
 * importer binds each name to a row the user actually owns and produces a
 * `ConnectedReference` the generation routes can resolve. That binding is the
 * whole difference between "a production with a character in it" and "a
 * production with a character's NAME in it", which is why the library is
 * fetched per request rather than cached: a character created a minute ago has
 * to bind on the next import.
 *
 * Every read goes through `entityOwnerFilter` — the one ownership predicate —
 * so a row that is not the caller's comes back as zero rows and "not yours" and
 * "does not exist" stay the same answer.
 */

/** How many rows of each kind a plan may bind against. */
const PER_KIND_LIMIT = 300

interface EntityRow {
  id: string
  name: string
  source_image_url?: string | null
  canonical_description?: string | null
}

type LibraryKind = "character" | "location" | "object" | "creature"

/** The `ConnectedReference` source each library maps onto. */
const REFERENCE_KIND: Record<LibraryKind, "character" | "location" | "creature" | "image"> = {
  character: "character",
  location: "location",
  creature: "creature",
  // An object binds as a plain media reference: it auto-attaches and has no
  // mention-slug machinery of its own, exactly as `toConnectedReference` docs.
  object: "image",
}

async function rowsOf(table: string, userId: string): Promise<EntityRow[]> {
  const { data, error } = await entityOwnerFilter(
    supabase
      .from(table)
      .select("id, name, source_image_url, canonical_description")
      .order("updated_at", { ascending: false })
      .limit(PER_KIND_LIMIT),
    userId,
  )
  if (error) throw new Error(`Failed to read ${table}: ${error.message}`)
  return (data ?? []) as unknown as EntityRow[]
}

function toCandidate(row: EntityRow, kind: LibraryKind): MentionCandidate {
  return {
    id: row.id,
    name: row.name,
    kind,
    toConnectedReference: () =>
      toConnectedReference({
        id: row.id,
        kind: REFERENCE_KIND[kind],
        name: row.name,
        url: row.source_image_url ?? "",
        description: row.canonical_description ?? null,
      }),
  }
}

/** Every row of every library the caller owns, as importer candidates. */
export async function mentionCandidatesFor(userId: string): Promise<MentionCandidate[]> {
  const [characters, locations, objects, creatures] = await Promise.all([
    rowsOf("characters", userId),
    rowsOf("locations", userId),
    rowsOf("objects", userId),
    rowsOf("creatures", userId),
  ])
  return [
    ...characters.map((r) => toCandidate(r, "character")),
    ...locations.map((r) => toCandidate(r, "location")),
    ...objects.map((r) => toCandidate(r, "object")),
    ...creatures.map((r) => toCandidate(r, "creature")),
  ]
}
