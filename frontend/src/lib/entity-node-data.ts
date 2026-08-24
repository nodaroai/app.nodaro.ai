/**
 * Bind a library / gallery asset onto an entity node — the single source of
 * truth for "pick an existing Character / Object / Creature / Location, or
 * REPLACE the one already bound."
 *
 * All four entity nodes store a `*DbId` reference plus a denormalized copy of
 * the entity's display fields and asset buckets. The in-node AssetPicker (My
 * Library + Public Gallery) resolves to a single entity id; this module rebinds
 * the node and carries EVERY bucket from the FULL detail row, so
 * pick == replace == fully populated for all four types (the old per-gallery
 * code copied only the lightweight list fields for object/creature/location,
 * which silently dropped buckets on a swap).
 *
 * Mirrors the proven character hydrate (`character-node-data.ts`): it re-reads
 * the node fresh before writing and bails if a concurrent load rebound the node
 * to a different asset, so a late fetch can never clobber the wrong node.
 */
import type {
  CharacterNodeData,
  ObjectNodeData,
  CreatureNodeData,
  LocationNodeData,
} from "@/types/nodes"
import type { DbObject, DbCreature, DbLocation } from "@/lib/api"
import { getCharacter, getObjectById, getCreatureById, getLocationById } from "@/lib/api"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { mergeCharacterDetailIntoNodeData } from "@/lib/character-node-data"

export const ENTITY_KINDS = ["character", "object", "creature", "location"] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/** The `data.*DbId` field that binds each entity node to its DB row. */
export const ENTITY_DB_ID_FIELD: Record<EntityKind, string> = {
  character: "characterDbId",
  object: "objectDbId",
  creature: "creatureDbId",
  location: "locationDbId",
}

function currentDbId(kind: EntityKind, data: Record<string, unknown>): string {
  return (data[ENTITY_DB_ID_FIELD[kind]] as string) || ""
}

type CharacterDetail = NonNullable<Awaited<ReturnType<typeof getCharacter>>>

/** Whatever `fetchDetail` resolves to, for any kind. */
type EntityDetail = CharacterDetail | DbObject | DbCreature | DbLocation

async function fetchDetail(
  kind: EntityKind,
  entityId: string,
): Promise<CharacterDetail | DbObject | DbCreature | DbLocation | null> {
  switch (kind) {
    case "character":
      return getCharacter(entityId)
    case "object":
      return getObjectById(entityId)
    case "creature":
      return getCreatureById(entityId)
    case "location":
      return getLocationById(entityId)
  }
}

// --- per-kind full-detail → node-data patch (carry EVERY bucket) ---

function mergeObjectDetail(prev: ObjectNodeData, fresh: DbObject): Partial<ObjectNodeData> {
  return {
    objectName: fresh.name || prev.objectName,
    description: fresh.description ?? "",
    category: (fresh.category as ObjectNodeData["category"]) ?? prev.category,
    style: (fresh.style as ObjectNodeData["style"]) ?? prev.style,
    sourceImageUrl: fresh.sourceImageUrl ?? "",
    angles: fresh.angles ?? [],
    materials: fresh.materials ?? [],
    variations: fresh.variations ?? [],
    motionClips: fresh.motionClips ?? [],
    referencePhotos: (fresh.referencePhotos as ObjectNodeData["referencePhotos"]) ?? [],
    canonicalDescription: fresh.canonicalDescription ?? "",
    styleLock: fresh.styleLock ?? true,
    sheets: fresh.sheets ?? [],
    detailCloseups: (fresh.detailCloseups as ObjectNodeData["detailCloseups"]) ?? [],
  }
}

function mergeCreatureDetail(prev: CreatureNodeData, fresh: DbCreature): Partial<CreatureNodeData> {
  return {
    creatureName: fresh.name || prev.creatureName,
    description: fresh.description ?? "",
    species: fresh.species ?? prev.species ?? "",
    category: fresh.category ?? prev.category ?? "",
    style: (fresh.style as CreatureNodeData["style"]) ?? prev.style,
    sourceImageUrl: fresh.sourceImageUrl ?? "",
    angles: fresh.angles ?? [],
    poses: fresh.poses ?? [],
    variations: fresh.variations ?? [],
    motionClips: fresh.motionClips ?? [],
    referencePhotos: (fresh.referencePhotos as CreatureNodeData["referencePhotos"]) ?? [],
    voice: fresh.voice ?? null,
    canonicalDescription: fresh.canonicalDescription ?? "",
    styleLock: fresh.styleLock ?? true,
    sheets: fresh.sheets ?? [],
    detailCloseups: (fresh.detailCloseups as CreatureNodeData["detailCloseups"]) ?? [],
  }
}

function mergeLocationDetail(prev: LocationNodeData, fresh: DbLocation): Partial<LocationNodeData> {
  return {
    locationName: fresh.name || prev.locationName,
    description: fresh.description ?? "",
    category: (fresh.category as LocationNodeData["category"]) ?? prev.category,
    style: (fresh.style as LocationNodeData["style"]) ?? prev.style,
    sourceImageUrl: fresh.sourceImageUrl ?? "",
    timeOfDay: fresh.timeOfDay ?? [],
    weather: fresh.weather ?? [],
    angles: fresh.angles ?? [],
    lighting: fresh.lighting ?? [],
    seasons: fresh.seasons ?? [],
    atmosphereMotions: fresh.atmosphereMotions ?? [],
    referencePhotos: (fresh.referencePhotos as LocationNodeData["referencePhotos"]) ?? [],
    canonicalDescription: fresh.canonicalDescription ?? "",
    styleLock: fresh.styleLock ?? true,
    sheets: fresh.sheets ?? [],
    detailCloseups: (fresh.detailCloseups as LocationNodeData["detailCloseups"]) ?? [],
  }
}

function mergePatch(
  kind: EntityKind,
  prev: Record<string, unknown>,
  fresh: CharacterDetail | DbObject | DbCreature | DbLocation,
): Record<string, unknown> {
  switch (kind) {
    case "character":
      return mergeCharacterDetailIntoNodeData(prev as CharacterNodeData, fresh as CharacterDetail)
    case "object":
      return mergeObjectDetail(prev as ObjectNodeData, fresh as DbObject)
    case "creature":
      return mergeCreatureDetail(prev as CreatureNodeData, fresh as DbCreature)
    case "location":
      return mergeLocationDetail(prev as LocationNodeData, fresh as DbLocation)
  }
}

/**
 * Rebind entity `nodeId` (of `kind`) to the library/gallery asset `entityId`,
 * carrying every bucket from the full detail row. Resolves `true` once the node
 * was rebound, `false` if the fetch failed, the asset is gone, or a concurrent
 * load rebound the node in the meantime (so the picker can keep its modal open
 * on failure). Never throws.
 */
export async function bindEntityNodeFromLibrary(
  kind: EntityKind,
  nodeId: string,
  entityId: string,
): Promise<boolean> {
  const node = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== kind) return false
  const fromId = currentDbId(kind, node.data as Record<string, unknown>)

  let fresh: CharacterDetail | DbObject | DbCreature | DbLocation | null
  try {
    fresh = await fetchDetail(kind, entityId)
  } catch {
    return false
  }
  if (!fresh) return false

  const cur = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
  if (!cur || cur.type !== kind) return false
  // Concurrency guard: bail if the node was rebound while we were fetching.
  if (currentDbId(kind, cur.data as Record<string, unknown>) !== fromId) return false

  const patch = mergePatch(kind, cur.data as Record<string, unknown>, fresh)
  const invariants: Record<string, unknown> = {
    [ENTITY_DB_ID_FIELD[kind]]: entityId,
    // The new asset's own image must drive the thumbnail — drop any per-node
    // override that pointed at the previously-bound asset.
    defaultAssetUrl: undefined,
    defaultAssetName: undefined,
  }
  // The three generation-capable entities also carry ad-hoc node-run output;
  // clear it on rebind so a stale result can't masquerade as the new asset.
  // Character has no node-level generation, so its run-state is left untouched.
  if (kind !== "character") {
    invariants.generatedResults = []
    invariants.activeResultIndex = 0
    invariants.executionStatus = "idle"
  }

  useWorkflowStore.getState().updateNodeData(nodeId, { ...cur.data, ...patch, ...invariants })
  return true
}

// --- refresh (same entity, re-read from DB) ---

/**
 * An entity node whose media never made it onto it.
 *
 * The node carries a `*DbId` and nothing else — the shape produced by every
 * writer that has no browser in the loop: the Copilot's `edit_workflow`, an MCP
 * client, a template import. The run engine hydrates these server-side, so the
 * RUN is correct either way; this is what stops the canvas from showing an
 * empty card until the user reloads the page.
 */
function isMissingMedia(data: Record<string, unknown>): boolean {
  const canonical = data.defaultAssetUrl ?? data.sourceImageUrl
  return typeof canonical !== "string" || canonical.length === 0
}

/**
 * Re-read entity `nodeId`'s CURRENT binding and merge the full detail back in.
 *
 * The rebind sibling above changes which entity a node points at; this one
 * keeps the binding and refreshes what it copied. Same concurrency guard (node
 * still exists, still this kind, still this id), same non-fatal failure, and a
 * deep-equality check so an unchanged refresh never marks the workflow dirty.
 */
export function refreshEntityNodeFromDetail(
  kind: EntityKind,
  nodeId: string,
  entityId: string,
  /** A detail fetch already in flight for this entity — see `refreshEntityNodes`. */
  pending?: Promise<EntityDetail | null>,
): void {
  void (pending ?? fetchDetail(kind, entityId))
    .then((fresh) => {
      if (!fresh) return
      const cur = useWorkflowStore.getState().nodes.find((n) => n.id === nodeId)
      if (!cur || cur.type !== kind) return
      if (currentDbId(kind, cur.data as Record<string, unknown>) !== entityId) return
      const merged = { ...(cur.data as Record<string, unknown>), ...mergePatch(kind, cur.data as Record<string, unknown>, fresh) }
      if (JSON.stringify(merged) === JSON.stringify(cur.data)) return
      // Re-derived, never authored: see `fromDatabase` on updateNodeData.
      useWorkflowStore.getState().updateNodeData(nodeId, merged, { fromDatabase: true })
    })
    .catch(() => {})
}

/**
 * Refresh the entity nodes in `nodes` from their live rows. Fire-and-forget.
 *
 * Two callers, two appetites, one implementation — so a fifth entity kind is
 * covered in both places by existing there at all:
 * - `loadWorkflow` refreshes EVERY entity node, because studio-added buckets
 *   (expressions, poses, wardrobe) land after the node was placed and the saved
 *   JSON holds a stale snapshot.
 * - `reconcileFromRemote` refreshes only nodes with NO media, because it fires
 *   on every remote write and a blanket refresh would be one request per entity
 *   node per keystroke elsewhere.
 *
 * Read-only (Studio) workflows are skipped by the caller — Studio owns writes.
 */
export function refreshEntityNodes(
  nodes: ReadonlyArray<{ id: string; type?: string; data?: unknown }>,
  opts: { onlyMissingMedia?: boolean } = {},
): void {
  // One fetch per ENTITY, not per node. This runs over the whole canvas on
  // every load, and the same character placed in four shots is four identical
  // requests otherwise — these call the API directly, so nothing upstream
  // dedupes them.
  const fetched = new Map<string, Promise<EntityDetail | null>>()
  for (const node of nodes) {
    const kind = ENTITY_KINDS.find((k) => k === node.type)
    if (!kind) continue
    const data = (node.data ?? {}) as Record<string, unknown>
    if (opts.onlyMissingMedia && !isMissingMedia(data)) continue
    const entityId = currentDbId(kind, data)
    if (!entityId) continue
    const key = `${kind}:${entityId}`
    let pending = fetched.get(key)
    if (!pending) {
      pending = fetchDetail(kind, entityId).catch(() => null)
      fetched.set(key, pending)
    }
    refreshEntityNodeFromDetail(kind, node.id, entityId, pending)
  }
}
