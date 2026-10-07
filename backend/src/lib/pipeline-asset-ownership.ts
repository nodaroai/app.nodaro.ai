/**
 * A pipeline entity's asset pointers say WHICH asset, not whose
 * (decided 2026-10-07; migration 480).
 *
 * `pipeline_entities.main_asset_id` and `metadata.last_attempted_asset_id`
 * name an `assets` row by id. The server reads them back with the service
 * role, which sees every user's assets, and turns them into a reference image
 * for the next generation, a canvas node's picture, an entity card's URL, or
 * (force-approve) the entity's adopted main image. Every legitimate writer
 * stores an asset the pipeline's owner made, and since 480 a trigger refuses
 * any other for every writer. A pointer written before that is counted by the
 * migration and left in place, so each read also asks for the owner's asset:
 * a pointer at another user's asset resolves to nothing.
 *
 * Every helper fails closed: a missing owner, a failed read or a non-owned id
 * yields no asset, never another user's.
 */
import type { SupabaseClient } from "@supabase/supabase-js"

/** The same shape migration 480's trigger demands of a new asset pointer. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Only a uuid-shaped string can name an `assets` row. Anything else (a
 * free-form `metadata.last_attempted_asset_id` kept from before 480) names no
 * asset, and passing it to `.in("id", …)` on the uuid column would make
 * Postgres reject the whole query (22P02) rather than just miss that id.
 */
function isAssetId(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id)
}

/** The pipeline's owner, or null when the pipeline is missing or the read fails. */
export async function pipelineOwnerId(
  supabase: SupabaseClient,
  pipelineId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("pipelines")
    .select("user_id")
    .eq("id", pipelineId)
    .maybeSingle()
  if (error || !data) return null
  return ((data as { user_id?: string | null }).user_id as string | null) ?? null
}

/**
 * How many ids one `.in("id", …)` asks about. A finished pipeline names
 * hundreds of asset ids (every shot's keyframe, clip, last frame, audio and
 * lip-sync, per scene), and one request carrying all of them is a query
 * string of 20+ KB that the gateway refuses (round 3 review, decided
 * 2026-10-07). Same bound as `key-ownership.ts`.
 */
const OWNED_ASSET_LOOKUP_CHUNK = 100

/**
 * The asset ids among `assetIds` that `ownerId` owns, mapped to their public
 * URL (`r2_url`, null when the row has none). An id another user owns, one
 * with no row, or one that is not a uuid, is absent from the map. Keys are
 * the rows' ids (lower case, as Postgres prints a uuid).
 *
 * The ids are asked in chunks of {@link OWNED_ASSET_LOOKUP_CHUNK}, one query
 * after another, and the answers merged. A failed chunk contributes nothing,
 * which suits a read that only drops a reference. A caller that WRITES the
 * answer (a branch copying the pointers into new rows) passes `throwOnError`,
 * so any failed chunk fails the write instead of storing rows with their
 * pointers stripped.
 */
export async function ownedAssetUrlsById(
  supabase: SupabaseClient,
  assetIds: ReadonlyArray<string | null | undefined>,
  ownerId: string | null,
  opts: { throwOnError?: boolean } = {},
): Promise<Map<string, string | null>> {
  const owned = new Map<string, string | null>()
  const ids = [...new Set(assetIds.filter(isAssetId).map((id) => id.toLowerCase()))]
  if (!ownerId || ids.length === 0) return owned
  for (let i = 0; i < ids.length; i += OWNED_ASSET_LOOKUP_CHUNK) {
    const chunk = ids.slice(i, i + OWNED_ASSET_LOOKUP_CHUNK)
    const { data, error } = await supabase
      .from("assets")
      .select("id, r2_url")
      .in("id", chunk)
      .eq("user_id", ownerId)
    if (error) {
      if (opts.throwOnError) throw new Error(`owned-asset lookup failed: ${error.message}`)
      continue
    }
    for (const row of (data ?? []) as Array<{ id: string; r2_url: string | null }>) {
      owned.set(row.id, row.r2_url ?? null)
    }
  }
  return owned
}

/** The same lookup for a pipeline: its owner's assets among `assetIds`. */
export async function pipelineOwnedAssetUrlsById(
  supabase: SupabaseClient,
  pipelineId: string,
  assetIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string | null>> {
  if (!assetIds.some(isAssetId)) return new Map()
  return ownedAssetUrlsById(supabase, assetIds, await pipelineOwnerId(supabase, pipelineId))
}

/**
 * A scene's asset ids inside `metadata.scene_node_data` (round 3, decided
 * 2026-10-07): each shot's `keyframe_asset_id`, `video_asset_id`,
 * `last_frame_asset_id`, `audio_asset_id` and `lipsynced_asset_id`, the
 * scene's `composite_video_asset_id`, and the `asset_id` of its asset refs.
 * The rule is the one migration 480's trigger applies — any key named
 * `asset_id` or ending in `_asset_id`, at any depth, whose value is a
 * uuid-shaped string — so a field the schema adds later is covered too.
 */
const SCENE_ASSET_ID_KEY = /(^|_)asset_id$/

function isSceneAssetIdEntry(key: string, value: unknown): value is string {
  return SCENE_ASSET_ID_KEY.test(key) && isAssetId(value)
}

/** Every asset id `sceneNodeData` names, in the trigger's sense. */
export function sceneNodeDataAssetIds(sceneNodeData: unknown): string[] {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (isSceneAssetIdEntry(key, value)) out.push(value)
        else walk(value)
      }
    }
  }
  walk(sceneNodeData)
  return out
}

/**
 * A copy of `sceneNodeData` without the asset ids `owned` does not hold (an
 * id is compared in lower case, as Postgres compares uuids), each with its
 * matching url (decided 2026-10-07): `X_asset_id` goes with `X_url`, and an
 * asset ref (`{ asset_id, url }`) goes whole. A value that is not a uuid
 * names no asset and is kept. The input is never mutated.
 */
export function withoutForeignSceneAssetIds<T>(sceneNodeData: T, owned: ReadonlyMap<string, unknown>): T {
  return withoutForeignSceneRefs(sceneNodeData, { ownedIds: owned })
}

/**
 * A scene's storage urls (decided 2026-10-07; migration 482): every string
 * under a key named `url` or ending in `_url` or `_urls` (an array of
 * strings), at any depth — each shot's keyframe, clip, last frame, audio,
 * lipsynced and bridged-frame urls and its interpolation keyframes, the
 * scene's composite, and every asset ref's `url`. By key, like the ids, so a
 * field added later is covered too. The trigger applies the same rule.
 */
const SCENE_URL_KEY = /(^|_)urls?$/

/** Every url `sceneNodeData` names, in the trigger's sense. */
export function sceneNodeDataUrls(sceneNodeData: unknown): string[] {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
    } else if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (SCENE_URL_KEY.test(key) && typeof value === "string") out.push(value)
        else if (SCENE_URL_KEY.test(key) && Array.isArray(value)) {
          for (const item of value) if (typeof item === "string") out.push(item)
        } else walk(value)
      }
    }
  }
  walk(sceneNodeData)
  return out
}

/** `keyframe_asset_id` → `keyframe_url`; an asset ref's `asset_id` → `url`. */
function urlKeyOf(idKey: string): string {
  return idKey === "asset_id" ? "url" : `${idKey.slice(0, -"asset_id".length)}url`
}

/** `keyframe_url` → `keyframe_asset_id`; an asset ref's `url` → `asset_id`. */
function idKeyOf(urlKey: string): string | null {
  if (urlKey === "url") return "asset_id"
  return urlKey.endsWith("_url") ? `${urlKey.slice(0, -"url".length)}asset_id` : null
}

/** Marks a node a parent must remove: an array drops it, a property becomes null. */
const DROPPED = Symbol("dropped")

/**
 * A copy of `sceneNodeData` without its foreign references (decided
 * 2026-10-07):
 *   - with `ownedIds`, an asset id the map does not hold (the branch's
 *     copy: another user's asset, or one that is gone);
 *   - every url in `foreignUrls` (the readers' owner-checked copy).
 * A reference goes with its pair (`X_asset_id` with `X_url`); an asset ref
 * (an object with a bare `asset_id` or `url`) that loses either goes whole —
 * removed from its array, or null where it stood alone, as AssetRefSchema
 * allows — and a `*_urls` list holding one foreign url goes whole (its order
 * pairs with the shot's interpolation keyframes, so a gap would misalign
 * them). Everything else is kept. The input is never mutated.
 */
export function withoutForeignSceneRefs<T>(
  sceneNodeData: T,
  opts: {
    ownedIds?: ReadonlyMap<string, unknown>
    foreignUrls?: ReadonlySet<string>
  },
): T {
  const foreignUrls = opts.foreignUrls ?? new Set<string>()
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip).filter((item) => item !== DROPPED)
    if (!node || typeof node !== "object") return node
    const entries = Object.entries(node as Record<string, unknown>)
    const drop = new Set<string>()
    for (const [key, value] of entries) {
      if (opts.ownedIds && isSceneAssetIdEntry(key, value) && !opts.ownedIds.has(value.toLowerCase())) {
        drop.add(key)
        drop.add(urlKeyOf(key))
      }
      if (!SCENE_URL_KEY.test(key)) continue
      if (typeof value === "string" && foreignUrls.has(value)) {
        drop.add(key)
        const idKey = idKeyOf(key)
        if (idKey) drop.add(idKey)
      } else if (Array.isArray(value) && value.some((v) => typeof v === "string" && foreignUrls.has(v))) {
        drop.add(key)
      }
    }
    const isAssetRef = entries.some(([key]) => key === "asset_id" || key === "url")
    if (isAssetRef && (drop.has("asset_id") || drop.has("url"))) return DROPPED
    const next: Record<string, unknown> = {}
    for (const [key, value] of entries) {
      if (drop.has(key)) continue
      const kept = strip(value)
      next[key] = kept === DROPPED ? null : kept
    }
    return next
  }
  const out = strip(sceneNodeData)
  return (out === DROPPED ? null : out) as T
}

/**
 * Who asks. A READER (the default) downloads or forwards urls and judges only
 * our storage hosts. A WRITER (`forWrite`) is about to store the urls in a
 * scene row, which migration 482's trigger then judges on every host: it
 * asks the trigger's question too, so what it keeps the trigger accepts and
 * the write cannot fail half-way (review round, decided 2026-10-07).
 */
export type SceneUrlJudge = { forWrite?: boolean }

/**
 * The urls among `urls` that name an object another user made or (no maker
 * known) claimed first, for `ownerId` (lib/key-ownership.ts
 * `foreignStorageUrls`; throws when the lookup fails). Reached through a
 * DYNAMIC import so this module — which the pipeline routes import at load —
 * does not pull key-ownership's storage client and service-role client into
 * their graph.
 */
export async function foreignSceneUrls(
  supabase: SupabaseClient,
  ownerId: string,
  urls: readonly string[],
  judge: SceneUrlJudge = {},
): Promise<Set<string>> {
  if (urls.length === 0) return new Set()
  const { foreignStorageUrls } = await import("./key-ownership.js")
  return foreignStorageUrls(ownerId, urls, supabase, judge)
}

/**
 * The copy of a scene's data a reader that DOWNLOADS or FORWARDS its urls
 * uses (decided 2026-10-07): every url on our storage that another user made
 * or holds (lib/key-ownership.ts) is dropped, with its matching id. External
 * urls pass unchanged. The stored row is never rewritten from this copy — a
 * pre-existing foreign url stays where it is (counted by migration 482) and
 * is dropped again at every read. Throws when the lookup fails, so the step
 * fails rather than forwarding urls nobody judged. A caller that WRITES the
 * copy back to a scene row passes `{ forWrite: true }`.
 */
export async function ownedSceneNodeData<T>(
  supabase: SupabaseClient,
  ownerId: string,
  sceneNodeData: T,
  judge: SceneUrlJudge = {},
): Promise<T> {
  const urls = sceneNodeDataUrls(sceneNodeData)
  if (urls.length === 0) return sceneNodeData
  const foreignUrls = await foreignSceneUrls(supabase, ownerId, urls, judge)
  return foreignUrls.size > 0 ? withoutForeignSceneRefs(sceneNodeData, { foreignUrls }) : sceneNodeData
}

/**
 * The same, for scene entity rows, judged in one lookup: each row's copy
 * carries the owner-checked `metadata.scene_node_data`; a row without one is
 * returned as is. The input rows are never mutated, so a caller writes back
 * from its own rows, never from these.
 */
export async function withOwnedSceneRows<R extends { metadata?: Record<string, unknown> | null }>(
  supabase: SupabaseClient,
  ownerId: string,
  rows: readonly R[],
): Promise<R[]> {
  const urls = rows.flatMap((row) => sceneNodeDataUrls(row.metadata?.scene_node_data))
  if (urls.length === 0) return [...rows]
  const foreignUrls = await foreignSceneUrls(supabase, ownerId, urls)
  if (foreignUrls.size === 0) return [...rows]
  return rows.map((row) =>
    row.metadata && row.metadata.scene_node_data !== undefined
      ? {
          ...row,
          metadata: {
            ...row.metadata,
            scene_node_data: withoutForeignSceneRefs(row.metadata.scene_node_data, { foreignUrls }),
          },
        }
      : row,
  )
}
