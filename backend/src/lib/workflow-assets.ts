import { z } from "zod"
import { LOCATION_REFERENCE_PHOTO_KINDS } from "@nodaro/shared"
import type { WorkflowExport, WorkflowExportCharacter, WorkflowExportCreature, WorkflowExportLocation, WorkflowExportObject } from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { deriveAvailableName } from "./entity-naming.js"

/**
 * Shared helpers for the workflow export + import endpoints. Backed by both
 * `backend/src/routes/workflows.ts` (REST) and `backend/src/lib/mcp/tools/workflows.ts`
 * (MCP tools), since both surfaces need to:
 *   1. Validate an incoming bundle (Zod schema)
 *   2. Collect entity DB ids referenced by `character` / `object` / `creature` / `location` nodes
 *   3. Fetch those entity rows from Supabase, scoped to the caller
 *   4. Re-create those entities under the caller's account on import
 *   5. Remap node `data.{character,object,creature,location}DbId` fields to the new rows
 */

const assetVariantSchema = z.object({ name: z.string(), url: z.string() })

const referencePhotoSchema = z.object({
  kind: z.enum(LOCATION_REFERENCE_PHOTO_KINDS),
  url: z.string(),
})

const exportCharacterSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  gender: z.string().nullish(),
  style: z.string().nullish(),
  baseOutfit: z.string().nullish(),
  sourceImageUrl: z.string().nullish(),
  expressions: z.array(assetVariantSchema).optional(),
  poses: z.array(assetVariantSchema).optional(),
  lightingVariations: z.array(assetVariantSchema).optional(),
})

const exportObjectSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  style: z.string().nullish(),
  sourceImageUrl: z.string().nullish(),
  angles: z.array(assetVariantSchema).optional(),
  materials: z.array(assetVariantSchema).optional(),
  variations: z.array(assetVariantSchema).optional(),
})

// Animal/Creature entity (migration 206). Mirrors `exportObjectSchema` with the
// object→creature DELTA MAP: adds free-text `species`, `materials` slot → `poses`.
const exportCreatureSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  species: z.string().nullish(),
  style: z.string().nullish(),
  sourceImageUrl: z.string().nullish(),
  angles: z.array(assetVariantSchema).optional(),
  poses: z.array(assetVariantSchema).optional(),
  variations: z.array(assetVariantSchema).optional(),
})

const exportLocationSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  style: z.string().nullish(),
  sourceImageUrl: z.string().nullish(),
  timeOfDay: z.array(assetVariantSchema).optional(),
  weather: z.array(assetVariantSchema).optional(),
  angles: z.array(assetVariantSchema).optional(),
  // Location Studio Phase 1 (migration 124).
  lighting: z.array(assetVariantSchema).optional(),
  seasons: z.array(assetVariantSchema).optional(),
  atmosphereMotions: z.array(assetVariantSchema).optional(),
  referencePhotos: z.array(referencePhotoSchema).optional(),
  canonicalDescription: z.string().nullish(),
  styleLock: z.boolean().nullish(),
})

/** Zod shape of the JSON bundle produced by `export_workflow` / `GET /v1/workflows/:id/export`. */
export const workflowExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().optional(),
  name: z.string().min(1).max(200),
  nodes: z.array(z.record(z.unknown())),
  edges: z.array(z.record(z.unknown())),
  settings: z.record(z.unknown()).optional(),
  assets: z
    .object({
      characters: z.array(exportCharacterSchema),
      objects: z.array(exportObjectSchema),
      // Optional so bundles exported before Animal/Creature (migration 206) still parse.
      creatures: z.array(exportCreatureSchema).optional(),
      locations: z.array(exportLocationSchema),
    })
    .optional(),
})

const ASSET_FIELDS = [
  "characterDbId",
  "objectDbId",
  "creatureDbId",
  "locationDbId",
] as const

interface AssetIds {
  characterIds: string[]
  objectIds: string[]
  creatureIds: string[]
  locationIds: string[]
}

/**
 * A real Supabase `uuid`. Guards every entity id before it reaches a uuid-typed
 * `.in()` / `.eq()` filter.
 *
 * Pipeline / Film-Director materialized character/object/location/creature
 * nodes seed `*DbId: ""` placeholders (canvas-materializer.ts) for "not yet
 * bound to a DB entity". Those empty strings used to flow straight into
 * `.in("id", [""])` against a uuid column → Postgres
 * `invalid input syntax for type uuid: ""` → "Export failed" on the whole
 * workflow. Validating the format (not just `!== ""`) also rejects any other
 * non-uuid garbage a future writer might leave in those fields.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value)
}

/** Collect entity DB ids referenced by `character` / `object` / `creature` / `location` nodes. */
export function collectAssetIds(nodes: readonly Record<string, unknown>[]): AssetIds {
  const characterIds: string[] = []
  const objectIds: string[] = []
  const creatureIds: string[] = []
  const locationIds: string[] = []
  for (const node of nodes) {
    const data = (node.data ?? {}) as Record<string, unknown>
    if (node.type === "character" && isUuid(data.characterDbId)) {
      characterIds.push(data.characterDbId)
    } else if (node.type === "object" && isUuid(data.objectDbId)) {
      objectIds.push(data.objectDbId)
    } else if (node.type === "creature" && isUuid(data.creatureDbId)) {
      creatureIds.push(data.creatureDbId)
    } else if (node.type === "location" && isUuid(data.locationDbId)) {
      locationIds.push(data.locationDbId)
    }
  }
  return { characterIds, objectIds, creatureIds, locationIds }
}

function asVariants(value: unknown): Array<{ name: string; url: string }> {
  return Array.isArray(value) ? (value as Array<{ name: string; url: string }>) : []
}

function asReferencePhotos(value: unknown): Array<{ kind: string; url: string }> {
  return Array.isArray(value) ? (value as Array<{ kind: string; url: string }>) : []
}

function fetchByIds(table: string, columns: string, ids: string[], userId: string) {
  // Defense-in-depth: never let a non-uuid (empty placeholder, slug, …) reach a
  // uuid-typed `.in()` filter — one bad id rejects the whole query with
  // `invalid input syntax for type uuid`. Dedupe while we're here.
  const validIds = [...new Set(ids.filter(isUuid))]
  if (validIds.length === 0) {
    return Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
  }
  return supabase.from(table).select(columns).in("id", validIds).eq("user_id", userId)
}

type WorkflowAssets = NonNullable<WorkflowExport["assets"]>

/**
 * Fetch entity rows for the given asset ids (scoped to `userId`) and shape them
 * into the export-bundle format. Returns `{ error }` on DB error so callers
 * can surface a 500 / MCP error.
 */
export async function fetchExportAssets(
  ids: AssetIds,
  userId: string,
): Promise<WorkflowAssets | { error: string }> {
  const [charsRes, objsRes, creaturesRes, locsRes] = await Promise.all([
    fetchByIds(
      "characters",
      "id, node_id, name, description, gender, style, base_outfit, source_image_url, expressions, poses, lighting_variations",
      ids.characterIds,
      userId,
    ),
    fetchByIds(
      "objects",
      "id, node_id, name, description, style, source_image_url, angles, materials, variations",
      ids.objectIds,
      userId,
    ),
    fetchByIds(
      "creatures",
      "id, node_id, name, description, species, style, source_image_url, angles, poses, variations",
      ids.creatureIds,
      userId,
    ),
    fetchByIds(
      "locations",
      "id, node_id, name, description, style, source_image_url, time_of_day, weather, angles, lighting, seasons, atmosphere_motions, reference_photos, canonical_description, style_lock",
      ids.locationIds,
      userId,
    ),
  ])

  const firstError = charsRes.error ?? objsRes.error ?? creaturesRes.error ?? locsRes.error
  if (firstError) return { error: firstError.message }

  return {
    characters: (charsRes.data ?? []).map((row): WorkflowExportCharacter => {
      const r = row as Record<string, unknown>
      return {
        id: r.id as string,
        nodeId: r.node_id as string,
        name: r.name as string,
        description: (r.description ?? null) as string | null,
        gender: (r.gender ?? null) as string | null,
        style: (r.style ?? null) as string | null,
        baseOutfit: (r.base_outfit ?? null) as string | null,
        sourceImageUrl: (r.source_image_url ?? null) as string | null,
        expressions: asVariants(r.expressions),
        poses: asVariants(r.poses),
        lightingVariations: asVariants(r.lighting_variations),
      }
    }),
    objects: (objsRes.data ?? []).map((row): WorkflowExportObject => {
      const r = row as Record<string, unknown>
      return {
        id: r.id as string,
        nodeId: r.node_id as string,
        name: r.name as string,
        description: (r.description ?? null) as string | null,
        style: (r.style ?? null) as string | null,
        sourceImageUrl: (r.source_image_url ?? null) as string | null,
        angles: asVariants(r.angles),
        materials: asVariants(r.materials),
        variations: asVariants(r.variations),
      }
    }),
    creatures: (creaturesRes.data ?? []).map((row): WorkflowExportCreature => {
      const r = row as Record<string, unknown>
      return {
        id: r.id as string,
        nodeId: r.node_id as string,
        name: r.name as string,
        description: (r.description ?? null) as string | null,
        species: (r.species ?? null) as string | null,
        style: (r.style ?? null) as string | null,
        sourceImageUrl: (r.source_image_url ?? null) as string | null,
        angles: asVariants(r.angles),
        poses: asVariants(r.poses),
        variations: asVariants(r.variations),
      }
    }),
    locations: (locsRes.data ?? []).map((row): WorkflowExportLocation => {
      const r = row as Record<string, unknown>
      return {
        id: r.id as string,
        nodeId: r.node_id as string,
        name: r.name as string,
        description: (r.description ?? null) as string | null,
        style: (r.style ?? null) as string | null,
        sourceImageUrl: (r.source_image_url ?? null) as string | null,
        timeOfDay: asVariants(r.time_of_day),
        weather: asVariants(r.weather),
        angles: asVariants(r.angles),
        // Location Studio Phase 1 (migration 124).
        lighting: asVariants(r.lighting),
        seasons: asVariants(r.seasons),
        atmosphereMotions: asVariants(r.atmosphere_motions),
        referencePhotos: asReferencePhotos(r.reference_photos),
        canonicalDescription: (r.canonical_description ?? null) as string | null,
        styleLock: (r.style_lock ?? null) as boolean | null,
      }
    }),
  }
}

type AssetBundle = NonNullable<z.infer<typeof workflowExportSchema>["assets"]>
export type AssetKind = "character" | "object" | "creature" | "location"

export interface ReCreateAssetsError {
  kind: AssetKind
  message: string
}

/**
 * Re-create the bundle's entities under `{ userId, projectId }` and return a
 * map from each bundle's original DB id → the freshly-created row id. On the
 * first failure returns `{ error: { kind, message } }` and bails — callers
 * surface that as a 500 / MCP error without continuing the import.
 */
export async function reCreateAssets(
  assets: AssetBundle,
  userId: string,
  projectId: string,
): Promise<Map<string, string> | { error: ReCreateAssetsError }> {
  const idMap = new Map<string, string>()

  async function insertOne(
    table: string,
    kind: AssetKind,
    sourceId: string,
    row: Record<string, unknown>,
  ): Promise<ReCreateAssetsError | null> {
    const { data, error } = await supabase
      .from(table)
      .insert(row)
      .select("id")
      .single()
    if (error || !data) {
      return { kind, message: error?.message ?? `Failed to create ${kind}` }
    }
    idMap.set(sourceId, (data as Record<string, unknown>).id as string)
    return null
  }

  // Import ALWAYS creates a NEW character — it never merges into one the caller
  // already owns. But `characters` is the one asset table with a per-user unique
  // active-name index (`characters_user_name_active_unique`, migration 112), so a
  // bundle name already held by another active character used to trip 23505 and
  // 500 the whole import. Derive a free "<name>"/"<name> N" first and retry on
  // the 23505 race, mirroring routes/characters.ts::insertWithUniqueName.
  async function insertCharacterWithUniqueName(
    sourceId: string,
    baseName: string,
    row: Record<string, unknown>,
  ): Promise<ReCreateAssetsError | null> {
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        const name = await deriveAvailableName("characters", userId, baseName)
        const { data, error } = await supabase
          .from("characters")
          .insert({ ...row, name })
          .select("id")
          .single()
        if (!error && data) {
          idMap.set(sourceId, (data as Record<string, unknown>).id as string)
          return null
        }
        if (error && error.code !== "23505") {
          return { kind: "character", message: error.message }
        }
        // 23505 — a concurrent writer took the derived name; loop and re-derive.
      }
      return {
        kind: "character",
        message: `Couldn't insert a unique '${baseName}*' after retries.`,
      }
    } catch (e) {
      // deriveAvailableName throws when it exhausts "<name> N" candidates. Convert
      // it to reCreateAssets' structured {error} contract — the import route
      // surfaces result.error.message and never try/catches an escaping throw.
      return {
        kind: "character",
        message: e instanceof Error ? e.message : `Failed to create character '${baseName}'`,
      }
    }
  }

  for (const c of assets.characters) {
    const err = await insertCharacterWithUniqueName(c.id, c.name, {
      user_id: userId,
      node_id: c.nodeId,
      project_id: projectId,
      description: c.description ?? null,
      gender: c.gender ?? null,
      style: c.style ?? null,
      base_outfit: c.baseOutfit ?? null,
      source_image_url: c.sourceImageUrl ?? null,
      expressions: c.expressions ?? [],
      poses: c.poses ?? [],
      lighting_variations: c.lightingVariations ?? [],
    })
    if (err) return { error: err }
  }

  for (const o of assets.objects) {
    const err = await insertOne("objects", "object", o.id, {
      user_id: userId,
      node_id: o.nodeId,
      project_id: projectId,
      name: o.name,
      description: o.description ?? null,
      style: o.style ?? null,
      source_image_url: o.sourceImageUrl ?? null,
      angles: o.angles ?? [],
      materials: o.materials ?? [],
      variations: o.variations ?? [],
    })
    if (err) return { error: err }
  }

  // Animal/Creature (migration 206). Mirrors the object arm with the
  // object→creature DELTA MAP: `species` column + `materials` slot → `poses`.
  for (const c of assets.creatures ?? []) {
    const err = await insertOne("creatures", "creature", c.id, {
      user_id: userId,
      node_id: c.nodeId,
      project_id: projectId,
      name: c.name,
      description: c.description ?? null,
      species: c.species ?? null,
      style: c.style ?? null,
      source_image_url: c.sourceImageUrl ?? null,
      angles: c.angles ?? [],
      poses: c.poses ?? [],
      variations: c.variations ?? [],
    })
    if (err) return { error: err }
  }

  for (const l of assets.locations) {
    const err = await insertOne("locations", "location", l.id, {
      user_id: userId,
      node_id: l.nodeId,
      project_id: projectId,
      name: l.name,
      description: l.description ?? null,
      style: l.style ?? null,
      source_image_url: l.sourceImageUrl ?? null,
      time_of_day: l.timeOfDay ?? [],
      weather: l.weather ?? [],
      angles: l.angles ?? [],
      // Location Studio Phase 1 (migration 124). `style_lock` defaults to TRUE
      // — the DB column default + UX default both treat it as enabled when the
      // bundle predates the column.
      lighting: l.lighting ?? [],
      seasons: l.seasons ?? [],
      atmosphere_motions: l.atmosphereMotions ?? [],
      reference_photos: l.referencePhotos ?? [],
      canonical_description: l.canonicalDescription ?? null,
      style_lock: l.styleLock ?? true,
    })
    if (err) return { error: err }
  }

  return idMap
}

/**
 * Replace `characterDbId` / `objectDbId` / `creatureDbId` / `locationDbId` on
 * each node's `data` with the freshly-created ids from {@link reCreateAssets}.
 * Returns new node objects; inputs are not mutated.
 */
export function remapNodeAssetIds<T extends Record<string, unknown>>(
  nodes: readonly T[],
  idMap: ReadonlyMap<string, string>,
): T[] {
  return nodes.map((node) => {
    const data = { ...((node.data ?? {}) as Record<string, unknown>) }
    for (const field of ASSET_FIELDS) {
      const oldId = data[field]
      if (typeof oldId === "string" && idMap.has(oldId)) {
        data[field] = idMap.get(oldId)
      }
    }
    // Reference fields that are NOT bundled/remapped point at rows the importer
    // doesn't own. Clear them so the node lands unlinked rather than dangling at
    // the exporter's private row: `faceDbId` (the face node regenerates from its
    // inline data — the backend never reads faceDbId) and `referencedWorkflowId`
    // (a sub-workflow node's target; lands unlinked, fails fast rather than
    // silently resolving to the exporter's workflow). The `!idMap.has` guard
    // keeps this correct if either field ever joins ASSET_FIELDS (bundled).
    for (const field of ["faceDbId", "referencedWorkflowId"] as const) {
      const oldId = data[field]
      if (typeof oldId === "string" && oldId && !idMap.has(oldId)) {
        data[field] = ""
      }
    }
    return { ...node, data }
  })
}

/** Coerce a stored `nodes`/`edges` jsonb column into an array of plain objects. */
export function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (v): v is Record<string, unknown> => v !== null && typeof v === "object",
  )
}
