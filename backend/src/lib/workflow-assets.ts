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
  nodes: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
  settings: z.record(z.string(), z.unknown()).optional(),
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

/**
 * `ConnectedReference.source` → the bundle arm that can re-create it (#1088).
 *
 * `manual` / `wired-image` are plain media with no entity row behind them, and
 * `wired-face` has a row but NO export shape — `WorkflowExport.assets` carries
 * four arms, and a face is not one of them (the import remap clears `faceDbId`
 * for the same reason). All three are skipped: there is nothing to bundle.
 */
const REFERENCE_SOURCE_BUCKETS: Readonly<Record<string, keyof AssetIds>> = {
  "wired-character": "characterIds",
  "wired-object": "objectIds",
  "wired-creature": "creatureIds",
  "wired-location": "locationIds",
}

/**
 * How deep inside `node.data` a `references` array can sit before the walk
 * gives up. `generatedResults[i].references[j]` is depth 3; the headroom covers
 * the same nesting one level further in without inviting an unbounded walk.
 * Mirrors media-portability's `WALK_DEPTH`.
 */
const REFERENCE_WALK_DEPTH = 6

/**
 * The same budget for the workflow's freeform `settings` blob, which sits two
 * levels ABOVE a node's `data`: an app namespaces itself (`settings.studio`)
 * and indexes its own entries (`…​.shots[]`) before it reaches the shapes node
 * data starts at. Mirrors media-portability's `SETTINGS_WALK_DEPTH`.
 */
const SETTINGS_REFERENCE_WALK_DEPTH = REFERENCE_WALK_DEPTH + 2

/**
 * Push every entity id bound by a `references` array anywhere under `value`.
 *
 * The chips are found by the ARRAY'S NAME, not by a path: a studio production
 * carries them on `generatedResults[].references[]`, an editor-v2 scene on
 * `beats[].references[]`, and a plan on its per-stage `references[]` — one walk
 * covers all three, and the next site that grows them.
 */
function collectReferenceIds(
  value: unknown,
  depth: number,
  out: AssetIds,
  maxDepth: number = REFERENCE_WALK_DEPTH,
): void {
  if (depth > maxDepth || !value || typeof value !== "object") return
  if (Array.isArray(value)) {
    for (const item of value) collectReferenceIds(item, depth + 1, out, maxDepth)
    return
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "references" && Array.isArray(v)) {
      for (const entry of v) {
        if (!entry || typeof entry !== "object") continue
        const ref = entry as { id?: unknown; source?: unknown }
        const bucket =
          typeof ref.source === "string" ? REFERENCE_SOURCE_BUCKETS[ref.source] : undefined
        if (bucket && isUuid(ref.id)) out[bucket].push(ref.id)
      }
      continue
    }
    collectReferenceIds(v, depth + 1, out, maxDepth)
  }
}

/**
 * Collect entity DB ids referenced by `character` / `object` / `creature` /
 * `location` nodes AND by the `@`-chips (`ConnectedReference`) bound anywhere
 * in a node's data (#1088).
 *
 * The node fields alone were never enough: a graph that binds its entities
 * through chips instead of entity nodes — every studio production, by the
 * minimal-graph rule — exported ZERO assets and imported with dangling
 * references.
 *
 * `settings` is walked on the same terms when given: an app that keeps a second
 * view of its work in the freeform blob (studio's `settings.studio` — a shot's
 * PLAN and its beats carry chips there before anything is framed) binds
 * entities that appear nowhere in the graph. Collect and remap must find the
 * same chips, so whatever this walks, {@link remapSettingsReferences} re-points.
 */
export function collectAssetIds(
  nodes: readonly Record<string, unknown>[],
  settings?: unknown,
): AssetIds {
  const ids: AssetIds = { characterIds: [], objectIds: [], creatureIds: [], locationIds: [] }
  for (const node of nodes) {
    const data = (node.data ?? {}) as Record<string, unknown>
    if (node.type === "character" && isUuid(data.characterDbId)) {
      ids.characterIds.push(data.characterDbId)
    } else if (node.type === "object" && isUuid(data.objectDbId)) {
      ids.objectIds.push(data.objectDbId)
    } else if (node.type === "creature" && isUuid(data.creatureDbId)) {
      ids.creatureIds.push(data.creatureDbId)
    } else if (node.type === "location" && isUuid(data.locationDbId)) {
      ids.locationIds.push(data.locationDbId)
    }
    collectReferenceIds(data, 0, ids)
  }
  collectReferenceIds(settings, 0, ids, SETTINGS_REFERENCE_WALK_DEPTH)
  return ids
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

// The PLATFORM's export shape, not the zod-inferred one: the bundle handed to
// `reCreateAssets` has been through the media copy (media-portability), which
// speaks `WorkflowExport`. Every zod-parsed bundle is assignable to it — the
// schema is the narrower of the two — so both callers type-check unchanged.
type AssetBundle = WorkflowAssets
export type AssetKind = "character" | "object" | "creature" | "location"

export interface ReCreateAssetsError {
  kind: AssetKind
  message: string
}

/**
 * A row `reCreateAssets` created, as the chip remap needs it (#1088): the new
 * id to bind to, the name it actually landed under (a character's may have been
 * stepped to "<name> 2" to clear the unique index), and its canonical image.
 */
export interface CreatedAsset {
  id: string
  name: string
  sourceImageUrl: string | null
}

/** Bundle entity id (the exporter's) → the row created under the importer. */
export type CreatedAssetMap = ReadonlyMap<string, CreatedAsset>

/**
 * `importReport.assetIdMap`, the PUBLISHED wire shape (bundle entity id → the
 * created row's id). One builder for both import surfaces (REST + MCP) so the
 * two cannot drift, and unconditional: the documented contract is "present
 * whenever the bundle carried `assets`", so a bundle with empty arms — or one
 * whose every entity was quota-skipped — still answers with `{}` rather than
 * making a client tell "no map" apart from "no entities".
 */
export function assetIdMapForReport(idMap: CreatedAssetMap): Record<string, string> {
  return Object.fromEntries([...idMap].map(([bundleId, created]) => [bundleId, created.id]))
}

/**
 * The bundle entity ids an import DECLINED to create, from the report's
 * `assetsSkipped`. Fed to {@link remapNodeAssetIds} so an entity node whose row
 * was dropped lands unlinked instead of dangling at the exporter's row.
 */
export function droppedAssetIdsFromReport(
  assetsSkipped: ReadonlyArray<{ id: string }> | undefined,
): ReadonlySet<string> {
  return new Set((assetsSkipped ?? []).map((a) => a.id))
}

/**
 * Re-create the bundle's entities under `{ userId, projectId }` and return a
 * map from each bundle's original DB id → the freshly-created row. On the
 * first failure returns `{ error: { kind, message } }` and bails — callers
 * surface that as a 500 / MCP error without continuing the import.
 */
export async function reCreateAssets(
  assets: AssetBundle,
  userId: string,
  projectId: string,
): Promise<Map<string, CreatedAsset> | { error: ReCreateAssetsError }> {
  const idMap = new Map<string, CreatedAsset>()

  /** Record the created row from the id the DB returned + the row we sent. */
  function record(sourceId: string, id: string, row: Record<string, unknown>): void {
    idMap.set(sourceId, {
      id,
      name: (row.name ?? "") as string,
      sourceImageUrl: (row.source_image_url ?? null) as string | null,
    })
  }

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
    record(sourceId, (data as Record<string, unknown>).id as string, row)
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
        const insertedRow = { ...row, name }
        const { data, error } = await supabase
          .from("characters")
          .insert(insertedRow)
          .select("id")
          .single()
        if (!error && data) {
          // `name` — the DERIVED one, not the bundle's: a chip re-pointed at
          // this row must show the name the library actually holds.
          record(sourceId, (data as Record<string, unknown>).id as string, insertedRow)
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
 * Chip fields that mark a reference as pointing at a SPECIFIC IMAGE — an
 * expression, a pose, a weather pass, a mood-board photo, a user-attached extra
 * — rather than at the entity's canonical image. Such a chip's `url` is that
 * image's, so it must NOT be refreshed from the created row's
 * `source_image_url`; it follows the media copy instead (media-portability
 * rewrites `references[].url` like any other URL field, so a chip whose image
 * was copied already points at the copy).
 *
 * `isExtraRef` is the load-bearing one for the URL-BOUND kinds. Only a
 * CHARACTER view chip carries a `variantSlug`; an object / creature / location
 * view binds by url alone (no mention/variant machinery), so its only marker is
 * "the user attached exactly this image". Without it here, a prop's "Brass"
 * material view or a location's "rain" pass classifies as canonical and its url
 * is silently swapped for the entity's main image — a wrong generation input,
 * with nothing in the report to explain it.
 *
 * Residual, pre-existing and not reachable by field enumeration:
 * `toConnectedReference` drops the `variant` for `wired-creature` at
 * construction, so a creature chip built through that shared helper with a
 * variant url carries no marker at all. The helper is where that would be
 * fixed.
 */
const VARIANT_CHIP_FIELDS = [
  "variantSlug",
  "bucket",
  "locationVariantBucket",
  "locationVariantSlug",
  "locationReferencePhotoKind",
  "isExtraRef",
] as const

/** Re-point one `ConnectedReference` at its re-created row, or leave it alone. */
function repointReference(entry: unknown, idMap: CreatedAssetMap): unknown {
  if (!entry || typeof entry !== "object") return entry
  const ref = entry as Record<string, unknown>
  if (typeof ref.id !== "string") return entry
  const created = idMap.get(ref.id)
  // Not bundled (the importer already owns it, or it was skipped): leave the
  // chip exactly as it is — resolving or dropping it is the client's call.
  if (!created) return entry
  const isCanonical = VARIANT_CHIP_FIELDS.every((field) => !ref[field])
  // `defaultName` follows the row: the insert may have stepped it ("Kira 2")
  // to clear the per-user unique active-name index, and a chip that keeps
  // saying "Kira" while the library says "Kira 2" is a lie in the picker. The
  // cost is on the other side: a client that binds its stored prose by chip
  // NAME no longer matches the prose it saved. That degrades — the reference
  // still rides, unnamed in the prompt — where a mislabelled chip persists.
  return {
    ...ref,
    id: created.id,
    defaultName: created.name || ref.defaultName,
    ...(isCanonical && created.sourceImageUrl ? { url: created.sourceImageUrl } : {}),
  }
}

/**
 * Re-point every `references` array under `value` at the re-created rows.
 * Returns the SAME object when nothing changed, so an import that bundles no
 * assets rebuilds no node data. Mirrors {@link collectReferenceIds}' walk —
 * the two must find the same chips.
 */
function remapReferences(
  value: unknown,
  depth: number,
  idMap: CreatedAssetMap,
  maxDepth: number = REFERENCE_WALK_DEPTH,
): unknown {
  if (depth > maxDepth || !value || typeof value !== "object") return value
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item) => {
      const mapped = remapReferences(item, depth + 1, idMap, maxDepth)
      if (mapped !== item) changed = true
      return mapped
    })
    return changed ? next : value
  }
  let changed = false
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (key === "references" && Array.isArray(v)) {
      let armChanged = false
      const refs = v.map((entry) => {
        const next = repointReference(entry, idMap)
        if (next !== entry) armChanged = true
        return next
      })
      out[key] = armChanged ? refs : v
      changed ||= armChanged
      continue
    }
    const mapped = remapReferences(v, depth + 1, idMap, maxDepth)
    changed ||= mapped !== v
    out[key] = mapped
  }
  return changed ? out : value
}

/**
 * The `settings` half of the same remap (#1088). A workflow row holds TWO views
 * of the same production when its app keeps an index in the freeform blob —
 * studio's `settings.studio.shots[]` carries a shot's plan and beats, chips and
 * all — and a row whose nodes point at the importer's rows while its settings
 * still point at the exporter's is internally inconsistent: whichever view the
 * client reads decides whether the chips resolve.
 *
 * Same walk, same rules, one budget deeper (see
 * {@link SETTINGS_REFERENCE_WALK_DEPTH}). Returns the SAME object when nothing
 * changed. `settings` is opaque to us, so nothing here interprets it beyond the
 * `references` arrays {@link collectAssetIds} already bundled.
 */
export function remapSettingsReferences(
  settings: unknown,
  idMap: CreatedAssetMap,
): Record<string, unknown> | undefined {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return undefined
  return remapReferences(settings, 0, idMap, SETTINGS_REFERENCE_WALK_DEPTH) as Record<
    string,
    unknown
  >
}

/**
 * Replace `characterDbId` / `objectDbId` / `creatureDbId` / `locationDbId` on
 * each node's `data` with the freshly-created ids from {@link reCreateAssets},
 * and re-point every `@`-chip (`ConnectedReference`) bound in that data at the
 * same rows (#1088) — refreshing the chip's `defaultName` (and, for a chip on
 * the entity's canonical image, its `url`) from the row that was actually
 * created. Returns new node objects; inputs are not mutated.
 *
 * `droppedAssetIds` are bundle entity ids the import DECLINED to create (the
 * storage-quota drop, `report.assetsSkipped`) — see the clearing rule below.
 */
export function remapNodeAssetIds<T extends Record<string, unknown>>(
  nodes: readonly T[],
  idMap: CreatedAssetMap,
  droppedAssetIds: ReadonlySet<string> = new Set(),
): T[] {
  return nodes.map((node) => {
    const data = { ...((remapReferences(node.data ?? {}, 0, idMap) ?? {}) as Record<string, unknown>) }
    for (const field of ASSET_FIELDS) {
      const oldId = data[field]
      if (typeof oldId === "string" && idMap.has(oldId)) {
        data[field] = idMap.get(oldId)!.id
      } else if (typeof oldId === "string" && oldId && droppedAssetIds.has(oldId)) {
        // The bundle CARRIED this entity and the import declined to create it
        // (out of storage). The id is provably the exporter's row, so clear it
        // for the same reason `faceDbId` is cleared below — the node lands
        // unlinked, not dangling at a row this account cannot read. Only ids
        // the import itself dropped: an unmapped id in an asset-LESS bundle may
        // well be a valid row of the importer's own (a self-reimport), and
        // clearing that would break a working node.
        data[field] = ""
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
