/**
 * Refuse to bind a node to an entity that is not the user's.
 *
 * A `*DbId` the model made up, or copied out of a workflow it read, is the one
 * mistake this system used to absorb in complete silence: the write succeeds,
 * the run-time hydrator finds no row (it is scoped to the owner, by design),
 * `expandWiredCharacterRefs` skips the reference, and the user gets a finished
 * picture of the wrong person with their credits already spent.
 *
 * This turns that into an error at the moment the model made it, when it can
 * still call `list_characters` and pick a real one.
 *
 * NOT a security boundary — the boundary is that every read is owner-scoped,
 * so a foreign id yields nothing whether or not this check runs. It is a
 * helpfulness guard, which is why an infrastructure failure lets the write
 * through rather than blocking a legitimate edit on a flaky lookup.
 */
import { ENTITY_DB_ID_FIELD, ENTITY_NODE_KINDS, ENTITY_TABLE, type EntityNodeKind } from "@nodaro/shared"
import { supabase } from "../../../lib/supabase.js"
import { entityOwnerFilter } from "../../../lib/mcp/tools/_entity-scope.js"
import { isUuid } from "../../../lib/mcp/tools/_id-guard.js"
import { EditRejected } from "./edit-rejected.js"

/** The tool that would have given the model a real id. */
const FINDER: Record<EntityNodeKind, string> = {
  character: "list_characters",
  object: "list_objects",
  creature: "list_creatures",
  location: "list_locations",
}

interface NodeWrite {
  type?: unknown
  data?: Record<string, unknown> | undefined
}

const asId = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

/** How much of a model-supplied id to quote back. Unbounded input, bounded echo. */
const MAX_ECHOED_ID = 64

/**
 * Every entity id this call would write, grouped by kind.
 *
 * Read from the ARGS, never from the stored graph — ids already on the canvas
 * were checked when they were written, and re-checking them would make an edit
 * fail because of something the user did months ago.
 */
function claimedIds(writes: readonly NodeWrite[]): Map<EntityNodeKind, Set<string>> {
  const byKind = new Map<EntityNodeKind, Set<string>>()
  for (const write of writes) {
    if (!write.data) continue
    for (const kind of ENTITY_NODE_KINDS) {
      // A patch carries no `type`, so the FIELD is what identifies the kind —
      // `characterDbId` only ever means a character.
      const id = asId(write.data[ENTITY_DB_ID_FIELD[kind]])
      if (!id) continue
      const ids = byKind.get(kind) ?? new Set<string>()
      ids.add(id)
      byKind.set(kind, ids)
    }
  }
  return byKind
}

/**
 * Throws `EditRejected` naming the first id that is not in the user's library.
 *
 * One query per kind, run once per tool call — the ids come from the args, so
 * they cannot change between CAS attempts and this does not belong inside the
 * retry loop.
 */
export async function assertEntitiesAreTheirs(
  writes: readonly NodeWrite[],
  userId: string,
): Promise<void> {
  const wanted = claimedIds(writes)
  if (wanted.size === 0) return

  await Promise.all(
    [...wanted.entries()].map(async ([kind, ids]) => {
      // A value that cannot be a uuid is definitionally not a row we have, and
      // it must never reach the query: entity ids are a uuid column, so one
      // malformed value makes Postgres error, and the fail-open branch below
      // reads that as "could not check" and lets the write through. An INVENTED
      // id — the thing this guard exists to catch — is far more likely to be a
      // name than a uuid, so that was the one value walking straight past it.
      const wellFormed = [...ids].filter((id) => isUuid(id))
      const malformed = [...ids].filter((id) => !isUuid(id))

      let mine = new Set<string>()
      if (wellFormed.length > 0) {
        try {
          const query = supabase.from(ENTITY_TABLE[kind]).select("id").in("id", wellFormed)
          const { data, error } = await entityOwnerFilter(query, userId)
          // A lookup that could not run tells us nothing; let those ids through
          // rather than blocking a real edit on a transient database error.
          // Malformed ones are still rejected — no lookup was needed for them.
          if (error || !data) mine = new Set(wellFormed)
          else mine = new Set((data as { id: string }[]).map((row) => row.id))
        } catch {
          mine = new Set(wellFormed)
        }
      }

      const foreign = [...malformed, ...wellFormed.filter((id) => !mine.has(id))]
      if (foreign.length > 0) {
        const named = foreign.map((id) => id.slice(0, MAX_ECHOED_ID)).join(", ")
        throw new EditRejected(
          `${named} is not a ${kind} in this user's library. Call ${FINDER[kind]} and use an id from it — never invent one or copy one from another workflow.`,
        )
      }
    }),
  )
}
