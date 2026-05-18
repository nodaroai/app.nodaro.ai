import { z } from "zod"
import type {
  WorkflowExport,
  WorkflowExportCharacter,
  WorkflowExportLocation,
  WorkflowExportObject,
} from "@nodaro/shared"
import { LOCATION_REFERENCE_PHOTO_KINDS } from "@nodaro/shared"
import { supabase } from "./supabase.js"

/**
 * Shared helpers for the workflow export + import endpoints. Backed by both
 * `backend/src/routes/workflows.ts` (REST) and `backend/src/lib/mcp/tools/workflows.ts`
 * (MCP tools), since both surfaces need to:
 *   1. Validate an incoming bundle (Zod schema)
 *   2. Collect entity DB ids referenced by `character` / `object` / `location` nodes
 *   3. Fetch those entity rows from Supabase, scoped to the caller
 *   4. Re-create those entities under the caller's account on import
 *   5. Remap node `data.{character,object,location}DbId` fields to the new rows
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
      locations: z.array(exportLocationSchema),
    })
    .optional(),
})

const ASSET_FIELDS = ["characterDbId", "objectDbId", "locationDbId"] as const

interface AssetIds {
  characterIds: string[]
  objectIds: string[]
  locationIds: string[]
}

/** Collect entity DB ids referenced by `character` / `object` / `location` nodes. */
export function collectAssetIds(nodes: readonly Record<string, unknown>[]): AssetIds {
  const characterIds: string[] = []
  const objectIds: string[] = []
  const locationIds: string[] = []
  for (const node of nodes) {
    const data = (node.data ?? {}) as Record<string, unknown>
    if (node.type === "character" && typeof data.characterDbId === "string") {
      characterIds.push(data.characterDbId)
    } else if (node.type === "object" && typeof data.objectDbId === "string") {
      objectIds.push(data.objectDbId)
    } else if (node.type === "location" && typeof data.locationDbId === "string") {
      locationIds.push(data.locationDbId)
    }
  }
  return { characterIds, objectIds, locationIds }
}

function asVariants(value: unknown): Array<{ name: string; url: string }> {
  return Array.isArray(value) ? (value as Array<{ name: string; url: string }>) : []
}

function asReferencePhotos(value: unknown): Array<{ kind: string; url: string }> {
  return Array.isArray(value) ? (value as Array<{ kind: string; url: string }>) : []
}

function fetchByIds(table: string, columns: string, ids: string[], userId: string) {
  if (ids.length === 0) {
    return Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
  }
  return supabase.from(table).select(columns).in("id", ids).eq("user_id", userId)
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
  const [charsRes, objsRes, locsRes] = await Promise.all([
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
      "locations",
      "id, node_id, name, description, style, source_image_url, time_of_day, weather, angles, lighting, seasons, atmosphere_motions, reference_photos, canonical_description, style_lock",
      ids.locationIds,
      userId,
    ),
  ])

  const firstError = charsRes.error ?? objsRes.error ?? locsRes.error
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
export type AssetKind = "character" | "object" | "location"

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

  for (const c of assets.characters) {
    const err = await insertOne("characters", "character", c.id, {
      user_id: userId,
      node_id: c.nodeId,
      project_id: projectId,
      name: c.name,
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
 * Replace `characterDbId` / `objectDbId` / `locationDbId` on each node's `data`
 * with the freshly-created ids from {@link reCreateAssets}. Returns new node
 * objects; inputs are not mutated.
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
