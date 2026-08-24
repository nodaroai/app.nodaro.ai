/**
 * Fill in an entity node's media from its row, at RUN time.
 *
 * A `character` / `object` / `creature` / `location` node stores a `*DbId` plus
 * a denormalized copy of the entity's fields. The copy is made by the BROWSER —
 * on `loadWorkflow`, and only for characters. Anything that writes a node
 * without a browser in the loop therefore produces a node with an id and no
 * image: the Copilot's `edit_workflow`, an MCP client's `update_workflow_json`,
 * an imported template.
 *
 * That node does not fail. `expandWiredCharacterRefs` reads
 * `defaultAssetUrl || sourceImageUrl`, finds neither, and skips the reference —
 * so the run succeeds, the credits are spent, and the picture is of the wrong
 * person. Silence is the whole problem.
 *
 * Hydrating at run time rather than at write time is deliberate: a copy stamped
 * when the node was written goes stale the moment the user edits the entity,
 * which is exactly why the browser re-does it on every load. This reads the
 * entity as it is at the moment it is used.
 *
 * Ownership is the WORKFLOW OWNER's, not the runner's — a published app runs
 * against its creator's characters, and scoping to whoever pressed play would
 * silently strip them.
 */
import {
  ENTITY_BUCKET_FIELDS,
  ENTITY_DB_ID_FIELD,
  ENTITY_NAME_FIELD,
  ENTITY_TABLE,
  entityHydrationColumns,
  entityScalarFields,
  ENTITY_NODE_KINDS,
  type EntityNodeKind,
} from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { isUuid } from "./mcp/tools/_id-guard.js"
import { entityOwnerFilter } from "./mcp/tools/_entity-scope.js"

interface NodeLike {
  type?: unknown
  data?: Record<string, unknown>
}

/**
 * A usable entity id, or null.
 *
 * The uuid check is not cosmetic. Every id of a kind goes into ONE
 * `.in("id", …)` against a uuid column, so a single value that cannot be a
 * uuid — a name a model typed into `characterDbId`, a truncated paste — makes
 * Postgres reject the WHOLE query. The catch then swallows it and every other
 * character in the graph silently stays unhydrated: one bad node, and the bug
 * this module exists to prevent comes back for all of them.
 */
const asId = (value: unknown): string | null =>
  typeof value === "string" && isUuid(value) ? value : null

/** Already has its picture — leave it alone; the node may carry user edits. */
function needsHydration(data: Record<string, unknown>): boolean {
  const canonical = data.defaultAssetUrl ?? data.sourceImageUrl
  return typeof canonical !== "string" || canonical.length === 0
}

function applyRow(kind: EntityNodeKind, data: Record<string, unknown>, row: Record<string, unknown>): void {
  for (const [column, field] of entityScalarFields(kind)) {
    const value = row[column]
    if (value === undefined || value === null) continue
    // The name lives under a per-kind field (`characterName`, `objectName`, …).
    const target = field === "__name" ? ENTITY_NAME_FIELD[kind] : field
    // Never overwrite something already on the node: the user may have renamed
    // it here on purpose. Only FILL what is missing.
    const current = data[target]
    if (current === undefined || current === null || current === "") data[target] = value
  }
  for (const [column, field] of ENTITY_BUCKET_FIELDS[kind]) {
    const value = row[column]
    if (!Array.isArray(value) || value.length === 0) continue
    const current = data[field]
    if (!Array.isArray(current) || current.length === 0) data[field] = value
  }
}

/**
 * Say so when a lookup fails.
 *
 * Swallowing is the right behaviour and the dangerous one: this function exists
 * because a missing reference is invisible at run time, and a silent catch is
 * the same disease one layer up. A schema drift, a revoked grant, a table
 * rename must show up somewhere a person will eventually read.
 */
function warn(kind: EntityNodeKind, reason: string | undefined): void {
  console.warn(`[entity-hydration] ${kind} lookup failed, node left unhydrated: ${reason ?? "unknown"}`)
}

/**
 * Hydrate every entity node in place. Best-effort: a failed lookup leaves the
 * graph exactly as it was, because a run that proceeds without a reference is
 * strictly better than a run that does not happen at all.
 *
 * One query per KIND, never per node.
 */
export async function hydrateEntityNodes(nodes: readonly NodeLike[], ownerUserId: string): Promise<void> {
  if (!ownerUserId) return

  const wanted = new Map<EntityNodeKind, Map<string, Record<string, unknown>[]>>()
  for (const node of nodes) {
    const kind = ENTITY_NODE_KINDS.find((k) => k === node.type)
    if (!kind || !node.data || !needsHydration(node.data)) continue
    const id = asId(node.data[ENTITY_DB_ID_FIELD[kind]])
    if (!id) continue
    const byId = wanted.get(kind) ?? new Map()
    byId.set(id, [...(byId.get(id) ?? []), node.data])
    wanted.set(kind, byId)
  }
  if (wanted.size === 0) return

  await Promise.all(
    [...wanted.entries()].map(async ([kind, byId]) => {
      try {
        // Through the shared predicate, not a hand-written pair: this is the
        // third caller of "is this row this user's?", and the one place it is
        // allowed to be answered.
        const { data, error } = await entityOwnerFilter(
          supabase
            .from(ENTITY_TABLE[kind])
            .select(entityHydrationColumns(kind).join(", "))
            .in("id", [...byId.keys()]),
          ownerUserId,
        )
        if (error || !data) return warn(kind, error?.message)
        for (const row of data as unknown as Record<string, unknown>[]) {
          const id = asId(row.id)
          if (!id) continue
          for (const target of byId.get(id) ?? []) applyRow(kind, target, row)
        }
      } catch (err) {
        // Never let a hydration miss take the run down with it.
        warn(kind, err instanceof Error ? err.message : String(err))
      }
    }),
  )
}
