import { randomUUID } from "node:crypto"
import { lookPreviewStillUrl } from "@nodaro/prompts/picker-art"
import { supabase } from "../../lib/supabase.js"
import { deriveAvailableName } from "../../lib/entity-naming.js"
import { ensureDefaultProject } from "../../lib/default-project.js"
import { reserveStorageIfWithinLimit } from "../../utils/file-validation.js"
import { copyR2ObjectToPrefix, r2KeyFromOurUrl } from "../../lib/storage.js"
import { buildCloneRow, buildSnapshot, COMMUNITY_ENTITY_ADAPTERS, type EntityType } from "./community-entity-adapters.js"
import { copyEntityAssets, rollbackCopiedAssets } from "../services/community/copy-entity-assets.js"

/**
 * Nodaro Keepers — the ONE store behind the shared catalog of characters,
 * creatures, locations and objects (`ee/routes/keepers.ts`, migration 566).
 *
 * Three verbs, three tenancies, each spelled out at its `.from()`:
 *
 *   - the SHELF (`listKeeperCatalog`) is the deployment's: every caller, a
 *     guest included, reads the same rows — `catalog = true`, not archived,
 *     with a main image — and only the DISPLAY fields of each (`CATALOG_COLUMNS`,
 *     an explicit pick: never a user id, a prompt, a reference photo or a
 *     LoRA field);
 *   - marking a row (`setKeeperCatalog`) is the ADMIN's, on their own rows only
 *     (`user_id = adminUserId`); the route checks who is an admin;
 *   - using one (`copyKeeper`) writes the CALLER's row THROUGH THE COMMUNITY
 *     CLONE RULE (`community-entity-adapters.ts`, the one written contract for
 *     copying these four tables across users): the public text and the asset
 *     buckets, with every asset FILE copied into the caller's own storage
 *     (`copyEntityAssets`, charged to their quota) so no copy points at the
 *     admin's files — their deletes and the retention sweeps would take those
 *     away from under it; a premade or library voice carried, a custom or
 *     cloned voice reduced to its name and sample (never a usable voice id
 *     cross-user); the private picker selections, reference photos and LoRA
 *     fields never carried; a fresh `node_id`; the caller's default project.
 *     `catalog_source_id` names the source. One copy per (user, source): the
 *     unique index `uq_<table>_catalog_copy` is the lock, so a second call (or
 *     two at once) returns the same copy. An archived copy is un-archived
 *     rather than duplicated — the restore route must never meet two copies of
 *     one source.
 *
 * The listing is keyset-paginated over `(catalog_sort ASC, created_at DESC,
 * id DESC)`, the order migration 566's partial index serves. Without `kind`
 * the page runs through the kinds in `KEEPER_KINDS` order, the cursor carrying
 * the kind it is in. Every decoded cursor field is format-checked before it is
 * interpolated into a PostgREST `.or()` filter (`lib/keyset-cursor.ts` says
 * why: a comma or paren in a field is a filter injection), and a cursor that
 * fails is `invalid_cursor` — a 400 at the route, never a silent page 1.
 */

/** The kinds a shelf row can be, in the order a page without `kind` runs through them. */
export const KEEPER_KINDS = ["character", "creature", "location", "object"] as const
export type KeeperKind = (typeof KEEPER_KINDS)[number]
// The community clone's entity types are these four, under the same names.
const _kindsAreEntityTypes: readonly EntityType[] = KEEPER_KINDS

type KeeperTable = "characters" | "creatures" | "locations" | "objects"

/** The shelf's display fields — the whole of what the catalog hands out. */
const CATALOG_COLUMNS = "id, name, description, source_image_url, catalog_category, catalog_sort, created_at"

/** The width of the shelf tile picture (the CDN's resized copy; the full picture stays `imageUrl`). */
const PREVIEW_WIDTH = 480

/** Page size when the caller names none. */
export const KEEPER_CATALOG_LIMIT_DEFAULT = 50
/** The largest page a caller may ask for. */
export const KEEPER_CATALOG_LIMIT_MAX = 200
/** `catalog_sort` lives within ±this — the admin's body and a cursor are held to the same bound. */
export const KEEPER_CATALOG_SORT_MAX = 1_000_000

export interface KeeperCatalogItem {
  readonly id: string
  readonly kind: KeeperKind
  readonly name: string
  readonly description: string | null
  /** The main image, as stored. */
  readonly imageUrl: string
  /** A 480px-wide copy of it for a tile (the image itself off the resizing CDN). */
  readonly previewUrl: string
  readonly category: string | null
  readonly sort: number
  readonly createdAt: string
}

export interface KeeperCatalogPage {
  readonly data: readonly KeeperCatalogItem[]
  /** The cursor of the next page, or null on the last one. */
  readonly next: string | null
}

type CatalogRow = {
  id: string
  name: string
  description: string | null
  source_image_url: string | null
  catalog_category: string | null
  catalog_sort: number
  created_at: string
}

/** Whether `value` names one of the four kinds. */
export function isKeeperKind(value: unknown): value is KeeperKind {
  return typeof value === "string" && (KEEPER_KINDS as readonly string[]).includes(value)
}

function tableOf(kind: KeeperKind): KeeperTable {
  return COMMUNITY_ENTITY_ADAPTERS[kind].table
}

// ---------------------------------------------------------------------------
// The cursor
// ---------------------------------------------------------------------------

/** Where a page ends: the kind it is in and, after a row, that row's shelf position. */
interface CatalogCursor {
  readonly kind: KeeperKind
  readonly after?: { readonly sort: number; readonly createdAt: string; readonly id: string }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:?\d{2}|Z)?$/
const CURSOR_MAX_CHARS = 256

/** URL-safe (base64url), so a cursor pasted into a query string by hand survives. */
export function encodeCatalogCursor(cursor: CatalogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

/** The cursor, or null when it is absent, malformed or any field fails its format check (never throws). */
export function decodeCatalogCursor(raw: string | undefined | null): CatalogCursor | null {
  if (!raw || raw.length > CURSOR_MAX_CHARS) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const { kind, after } = parsed as { kind?: unknown; after?: unknown }
  if (!isKeeperKind(kind)) return null
  if (after === undefined) return { kind }
  if (!after || typeof after !== "object") return null
  const { sort, createdAt, id } = after as { sort?: unknown; createdAt?: unknown; id?: unknown }
  // A safe integer within the column's bound: `1e21` is an integer too, and
  // would reach the filter as "1e+21".
  if (typeof sort !== "number" || !Number.isSafeInteger(sort) || Math.abs(sort) > KEEPER_CATALOG_SORT_MAX) return null
  if (typeof createdAt !== "string" || !ISO_TS_RE.test(createdAt)) return null
  if (typeof id !== "string" || !UUID_RE.test(id)) return null
  return { kind, after: { sort, createdAt, id } }
}

/** The rows after `after` in shelf order, as one PostgREST `or` filter (every field validated by `decodeCatalogCursor`). */
function catalogKeysetFilter(after: NonNullable<CatalogCursor["after"]>): string {
  return (
    `catalog_sort.gt.${after.sort},` +
    `and(catalog_sort.eq.${after.sort},created_at.lt.${after.createdAt}),` +
    `and(catalog_sort.eq.${after.sort},created_at.eq.${after.createdAt},id.lt.${after.id})`
  )
}

// ---------------------------------------------------------------------------
// The shelf
// ---------------------------------------------------------------------------

function toItem(kind: KeeperKind, row: CatalogRow): KeeperCatalogItem | null {
  const imageUrl = row.source_image_url
  if (!imageUrl) return null
  return {
    id: row.id,
    kind,
    name: row.name,
    description: row.description ?? null,
    imageUrl,
    previewUrl: lookPreviewStillUrl(imageUrl, PREVIEW_WIDTH) ?? imageUrl,
    category: row.catalog_category ?? null,
    sort: row.catalog_sort,
    createdAt: row.created_at,
  }
}

type DbError = { readonly message: string }

/** Up to `limit + 1` shelf rows of one kind after `after` — the extra row is the has-more probe. */
async function shelfRows(
  kind: KeeperKind,
  after: CatalogCursor["after"],
  limit: number,
): Promise<{ rows: CatalogRow[]; error: DbError | null }> {
  let query = supabase
    .from(tableOf(kind))
    .select(CATALOG_COLUMNS)
    .eq("catalog", true)
    .is("deleted_at", null)
    .not("source_image_url", "is", null)
    .order("catalog_sort", { ascending: true })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
  if (after) query = query.or(catalogKeysetFilter(after))
  const { data, error } = await query.limit(limit + 1)
  return { rows: (data ?? []) as CatalogRow[], error: error ? { message: error.message } : null }
}

/** Whether a kind has any shelf row at all (the probe for a page that ended exactly at a kind's last row). */
async function shelfHasRows(kind: KeeperKind): Promise<{ has: boolean; error: DbError | null }> {
  const { data, error } = await supabase
    .from(tableOf(kind))
    .select("id")
    .eq("catalog", true)
    .is("deleted_at", null)
    .not("source_image_url", "is", null)
    .limit(1)
  return { has: (data ?? []).length > 0, error: error ? { message: error.message } : null }
}

export type ListKeeperCatalogResult =
  | KeeperCatalogPage
  | { readonly error: "invalid_cursor" | "internal_error"; readonly message?: string }

/**
 * One page of the shelf: `kind`'s rows, or — without `kind` — the kinds in
 * `KEEPER_KINDS` order, a page filling across a kind boundary. `next` is null
 * only when nothing follows; a probe that fails is an error, never a silent
 * end of the listing.
 */
export async function listKeeperCatalog(params: {
  readonly kind?: KeeperKind
  readonly cursor?: string
  readonly limit?: number
}): Promise<ListKeeperCatalogResult> {
  const limit = Math.min(Math.max(params.limit ?? KEEPER_CATALOG_LIMIT_DEFAULT, 1), KEEPER_CATALOG_LIMIT_MAX)
  const cursor = params.cursor ? decodeCatalogCursor(params.cursor) : null
  if (params.cursor && !cursor) return { error: "invalid_cursor" }
  if (cursor && params.kind && cursor.kind !== params.kind) return { error: "invalid_cursor" }

  const kinds: readonly KeeperKind[] = params.kind ? [params.kind] : KEEPER_KINDS
  const startAt = cursor ? kinds.indexOf(cursor.kind) : 0
  if (startAt < 0) return { error: "invalid_cursor" }

  let data: readonly KeeperCatalogItem[] = []
  for (let i = startAt; i < kinds.length; i++) {
    const kind = kinds[i]!
    const after = i === startAt ? cursor?.after : undefined
    const remaining = limit - data.length
    const { rows, error } = await shelfRows(kind, after, remaining)
    if (error) return { error: "internal_error", message: error.message }
    const items = rows.slice(0, remaining).flatMap((row) => {
      const item = toItem(kind, row)
      return item ? [item] : []
    })
    data = [...data, ...items]
    if (rows.length > remaining) {
      const last = rows[remaining - 1]!
      return { data, next: encodeCatalogCursor({ kind, after: { sort: last.catalog_sort, createdAt: last.created_at, id: last.id } }) }
    }
    if (data.length >= limit) {
      // The page ended exactly on this kind's last row: point the cursor at
      // the next kind that has a row, or end the listing.
      for (let j = i + 1; j < kinds.length; j++) {
        const probe = await shelfHasRows(kinds[j]!)
        if (probe.error) return { error: "internal_error", message: probe.error.message }
        if (probe.has) return { data, next: encodeCatalogCursor({ kind: kinds[j]! }) }
      }
      return { data, next: null }
    }
  }
  return { data, next: null }
}

// ---------------------------------------------------------------------------
// Marking a row (admin)
// ---------------------------------------------------------------------------

export interface SetKeeperCatalogInput {
  readonly catalog: boolean
  readonly sort?: number
  readonly category?: string | null
}

export type SetKeeperCatalogResult =
  | { readonly ok: true; readonly id: string; readonly catalog: boolean; readonly sort: number; readonly category: string | null }
  | { readonly error: "not_found" | "internal_error"; readonly message?: string }

/** Put one of the admin's OWN rows on the shelf, or take it off. A row that is not theirs (or is gone) is `not_found`. */
export async function setKeeperCatalog(
  kind: KeeperKind,
  id: string,
  adminUserId: string,
  input: SetKeeperCatalogInput,
): Promise<SetKeeperCatalogResult> {
  // A blank heading is no heading.
  const category = input.category === undefined ? undefined : input.category?.trim() || null
  const patch = {
    catalog: input.catalog,
    ...(input.sort !== undefined ? { catalog_sort: input.sort } : {}),
    ...(category !== undefined ? { catalog_category: category } : {}),
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabase
    .from(tableOf(kind))
    .update(patch)
    .eq("id", id)
    .eq("user_id", adminUserId)
    .is("deleted_at", null)
    .select("id, catalog, catalog_sort, catalog_category")
    .maybeSingle()
  if (error) return { error: "internal_error", message: error.message }
  if (!data) return { error: "not_found" }
  const row = data as { id: string; catalog: boolean; catalog_sort: number; catalog_category: string | null }
  return { ok: true, id: row.id, catalog: row.catalog, sort: row.catalog_sort, category: row.catalog_category ?? null }
}

// ---------------------------------------------------------------------------
// Using one (copy into the caller's account)
// ---------------------------------------------------------------------------

export type CopyKeeperError = "not_found" | "storage_limit_exceeded" | "personal_space_disabled" | "internal_error"

export type CopyKeeperResult =
  | { readonly ok: true; readonly id: string; readonly name: string; readonly created: boolean }
  | { readonly error: CopyKeeperError; readonly message?: string }

type CopyRow = { id: string; name: string; deleted_at: string | null; r2_assets_purged_at?: string | null }

/**
 * The caller's existing copy of `sourceId`, archived or not. For a location
 * the sweep's stamp rides along: a copy archived long enough for its files
 * to have been purged (`sweepSoftDeletedLocationAssets`) is dead, and the
 * caller gets a fresh copy instead of a restored row of broken links.
 */
async function existingCopy(kind: KeeperKind, userId: string, sourceId: string): Promise<{ copy: CopyRow | null; error: DbError | null }> {
  const columns = kind === "location" ? "id, name, deleted_at, r2_assets_purged_at" : "id, name, deleted_at"
  const { data, error } = await supabase
    .from(tableOf(kind))
    .select(columns)
    .eq("user_id", userId)
    .eq("catalog_source_id", sourceId)
    .maybeSingle()
  if (error) return { copy: null, error: { message: error.message } }
  return { copy: (data as CopyRow | null) ?? null, error: null }
}

/**
 * The caller's copy as it stands, or null when there is none — or when the
 * one there is dead: it is then detached from its source (`catalog_source_id`
 * cleared, the unique slot freed) so a fresh copy can be made, and stays in
 * the caller's archive like any other row of theirs; a copy is never
 * hard-deleted here.
 */
async function reuseExistingCopy(kind: KeeperKind, userId: string, sourceId: string): Promise<CopyKeeperResult | null> {
  const found = await existingCopy(kind, userId, sourceId)
  if (found.error) return { error: "internal_error", message: found.error.message }
  const copy = found.copy
  if (!copy) return null
  if (copy.r2_assets_purged_at) {
    const { error } = await supabase
      .from(tableOf(kind))
      .update({ catalog_source_id: null, updated_at: new Date().toISOString() })
      .eq("id", copy.id)
      .eq("user_id", userId)
    return error ? { error: "internal_error", message: error.message } : null
  }
  return copy.deleted_at ? restoreCopy(tableOf(kind), userId, copy) : { ok: true, id: copy.id, name: copy.name, created: false }
}

/**
 * A custom voice keeps only its name and sample, and the sample is not an
 * asset field: when it is the owner's OWN stored file, copy it into the same
 * prefix so no copy plays the owner's file. A sample hosted elsewhere (a
 * library or premade voice's public preview) is public already — it passes
 * through unchanged, costs the caller no storage, and cannot fail the copy.
 * A voice without a sample passes through too.
 */
async function copyVoiceSample(voice: unknown, destPrefix: string): Promise<{ voice: unknown; copiedUrl?: string; bytes: number }> {
  const v = voice as { previewUrl?: unknown } | null | undefined
  if (!v || typeof v !== "object" || typeof v.previewUrl !== "string" || !r2KeyFromOurUrl(v.previewUrl)) return { voice, bytes: 0 }
  const { url, bytes } = await copyR2ObjectToPrefix(v.previewUrl, destPrefix)
  return { voice: { ...v, previewUrl: url }, copiedUrl: url, bytes }
}

/** Un-archive the caller's archived copy; its name may have been taken since, so it is re-derived on a collision. */
async function restoreCopy(table: KeeperTable, userId: string, copy: CopyRow): Promise<CopyKeeperResult> {
  let name = copy.name
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from(table)
      .update({ deleted_at: null, name, updated_at: new Date().toISOString() })
      .eq("id", copy.id)
      .eq("user_id", userId)
      .select("id, name")
      .single()
    if (!error && data) return { ok: true, id: data.id as string, name: data.name as string, created: false }
    if (error && error.code !== "23505") return { error: "internal_error", message: error.message }
    try {
      name = await deriveAvailableName(table, userId, copy.name)
    } catch (err) {
      return { error: "internal_error", message: (err as Error).message }
    }
  }
  return { error: "internal_error", message: "Couldn't find a free name to restore the copy under." }
}

/** The columns a copy reads from its source: the adapter's public text and asset buckets, and the voice it carries by kind. */
function sourceColumns(kind: KeeperKind): string {
  const adapter = COMMUNITY_ENTITY_ADAPTERS[kind]
  const voice = kind === "character" || kind === "creature" ? ["voice"] : []
  return [...new Set(["id", "name", ...adapter.publicTextFields, ...adapter.assetFields, ...voice])].join(", ")
}

/**
 * The caller's own copy of catalog row `sourceId` of `kind`: the one they
 * already have (un-archived if need be), else a new row made through the
 * community clone rule (see the header) under their user_id and default
 * project, with `catalog_source_id` naming the source. No credits; the asset
 * files are copied into the caller's storage and counted against it
 * (`storage_limit_exceeded` when they do not fit — nothing is kept then).
 * `not_found` for a row that is not on the shelf, is archived or has no main
 * image; `personal_space_disabled` when the caller's organization closed the
 * personal space a copy would land in.
 */
export async function copyKeeper(kind: KeeperKind, sourceId: string, userId: string): Promise<CopyKeeperResult> {
  const existing = await reuseExistingCopy(kind, userId, sourceId)
  if (existing) return existing

  const source = await readCatalogSource(kind, sourceId)
  if ("error" in source) return source

  const project = await ensureDefaultProject(userId)
  if ("error" in project) return { error: "internal_error", message: project.error }
  if ("personalSpaceDisabled" in project) return { error: "personal_space_disabled" }

  const files = await copyFilesForCaller(kind, source.row, userId)
  if ("error" in files) return files

  return insertCopyWithRetry(kind, sourceId, userId, project.projectId, source.row.name, files)
}

type SourceRow = Record<string, unknown> & { name: string }
type CopyError = { readonly error: CopyKeeperError; readonly message?: string }

/** The shelf row a copy is made from: on the shelf, not archived, with a main image — else `not_found`. */
async function readCatalogSource(kind: KeeperKind, sourceId: string): Promise<{ row: SourceRow } | CopyError> {
  const { data, error } = await supabase
    .from(tableOf(kind))
    .select(sourceColumns(kind))
    .eq("id", sourceId)
    .eq("catalog", true)
    .is("deleted_at", null)
    .not("source_image_url", "is", null)
    .maybeSingle()
  if (error) return { error: "internal_error", message: error.message }
  if (!data) return { error: "not_found" }
  return { row: data as unknown as SourceRow }
}

/** The caller's copies of the source's files, charged to their storage, and the one way to give it all back. */
interface CopiedFiles {
  /** The community-clone snapshot of the source, every asset URL rewritten to the caller's copy. */
  readonly snapshot: Record<string, unknown>
  readonly copiedAssets: Record<string, unknown>
  /** Delete the copied files and refund the reservation (never throws; call once). */
  readonly undo: () => Promise<void>
}

/**
 * Every file of the source copied into the caller's own prefix (the one the
 * community clone uses, so storage accounting and the sweeps treat both
 * alike), then the bytes reserved against their storage. On any failure
 * nothing is left behind: the copies are deleted and nothing was reserved.
 */
async function copyFilesForCaller(kind: KeeperKind, sourceRow: SourceRow, userId: string): Promise<CopiedFiles | CopyError> {
  const destPrefix = `user-clones/${userId}/${randomUUID()}/`
  let copied: Awaited<ReturnType<typeof copyEntityAssets>>
  try {
    copied = await copyEntityAssets(kind, sourceRow, destPrefix)
  } catch (err) {
    return { error: "internal_error", message: (err as Error).message }
  }
  const stripped = buildSnapshot(kind, sourceRow, copied.copiedAssets)
  let sample: Awaited<ReturnType<typeof copyVoiceSample>>
  try {
    sample = await copyVoiceSample(stripped.voice, destPrefix)
  } catch (err) {
    await rollbackCopiedAssets(copied.copiedUrls, userId, 0).catch(() => {})
    return { error: "internal_error", message: (err as Error).message }
  }
  const copiedUrls = sample.copiedUrl ? [...copied.copiedUrls, sample.copiedUrl] : copied.copiedUrls
  const bytes = copied.bytes + sample.bytes
  if (!(await reserveStorageIfWithinLimit(userId, bytes))) {
    await rollbackCopiedAssets(copiedUrls, userId, 0).catch(() => {})
    return { error: "storage_limit_exceeded" }
  }
  return {
    snapshot: sample.copiedUrl ? { ...stripped, voice: sample.voice } : stripped,
    copiedAssets: copied.copiedAssets,
    undo: async () => rollbackCopiedAssets(copiedUrls, userId, bytes).catch(() => {}),
  }
}

/**
 * The caller's row, inserted under a free name — up to three tries, since a
 * 23505 is either the other of two concurrent calls making the copy first
 * (the idempotency index: hand that one back and undo these files) or a
 * writer taking the derived name (derive again). Every failure undoes the
 * files exactly once.
 */
async function insertCopyWithRetry(
  kind: KeeperKind,
  sourceId: string,
  userId: string,
  projectId: string,
  sourceName: string,
  files: CopiedFiles,
): Promise<CopyKeeperResult> {
  const table = tableOf(kind)
  for (let attempt = 0; attempt < 3; attempt++) {
    let name: string
    try {
      name = await deriveAvailableName(table, userId, sourceName)
    } catch (err) {
      await files.undo()
      return { error: "internal_error", message: (err as Error).message }
    }
    const row = {
      ...buildCloneRow(kind, files.snapshot, { userId, projectId, name, copiedAssets: files.copiedAssets }),
      catalog: false,
      catalog_source_id: sourceId,
    }
    const { data, error } = await supabase.from(table).insert(row).select("id, name").single()
    if (!error && data) return { ok: true, id: data.id as string, name: data.name as string, created: true }
    if (error && error.code !== "23505") {
      await files.undo()
      return { error: "internal_error", message: error.message }
    }
    const raced = await existingCopy(kind, userId, sourceId)
    if (raced.error) {
      await files.undo()
      return { error: "internal_error", message: raced.error.message }
    }
    if (raced.copy) {
      await files.undo()
      return raced.copy.deleted_at ? restoreCopy(table, userId, raced.copy) : { ok: true, id: raced.copy.id, name: raced.copy.name, created: false }
    }
  }
  await files.undo()
  return { error: "internal_error", message: "Couldn't copy the item under a free name after retries." }
}
