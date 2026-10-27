/**
 * The trend catalog's store (migration 549): trends, their versioned
 * snapshots and users' favorites, through the service-role client.
 *
 * Invariants this module keeps (the schema does not enforce them):
 *   - `draft_version ≥ 1` and `published_version ≤ draft_version`;
 *   - `published_version` only ever points at a version that has a row;
 *   - a version row that was ever published (`published_at` set) is never
 *     written again: saving a trend whose draft IS its published version
 *     writes version + 1 and moves the draft pointer (copy-on-write), and every
 *     data write is guarded on `published_at IS NULL`. The TWO exceptions are
 *     {@link attachDisplayCopy} (trends "show the original", S7): it adds
 *     `data.source.display` — derived display media a run never reads — to a
 *     version that lacks it, published or not, and {@link attachPreviewClip}:
 *     it adds `data.previewClip` — a deterministic cut of the version's own
 *     source at its own `previewStart`, which a preview run then edits in
 *     place of cutting the same window itself — to a version that lacks one;
 *     each leaves every other byte of `data`, the `revision` and
 *     `published_at` as they were ("byte" as JSONB keeps it: key order,
 *     whitespace and number spelling are Postgres's);
 *   - unpublishing keeps `published_version`, so the next save still copies;
 *   - every write of a version's data gives it a new `revision` (except the
 *     two attaches above), so a write or publish conditioned on the
 *     revision the caller read fails when it moved;
 *   - every write to `trends` sets `updated_at`.
 */
import { randomUUID } from "node:crypto"
import { supabase } from "../../../lib/supabase.js"
import { isMissingTableError } from "../../../lib/postgrest-errors.js"
import type { TrendBadge, TrendPreviewClip, TrendRow, TrendSourceDisplay, TrendStatus, TrendVersionData } from "./types.js"

const TREND_COLS = "id, slug, status, tags, badges, sort_order, draft_version, published_version, created_at, updated_at"

/** A save or publish re-reads the pointers and tries again when a concurrent write moved them. */
const MAX_ATTEMPTS = 3

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class TrendNotFoundError extends Error {
  constructor(readonly trendId: string) {
    super(`Trend ${trendId} not found.`)
    this.name = "TrendNotFoundError"
  }
}

/** A `cursor` this server did not issue. */
export class InvalidTrendCursorError extends Error {
  constructor() {
    super("Invalid cursor.")
    this.name = "InvalidTrendCursorError"
  }
}

/**
 * The trend tables are not in this database yet (Postgres `42P01` / PostgREST
 * `PGRST205`): migration 549 reaches the shared database only when `main`
 * deploys, and staging runs ahead of it. The routes answer 503 `not_available`.
 */
export class TrendsUnavailableError extends Error {
  constructor() {
    super("Trends are not available on this server yet.")
    this.name = "TrendsUnavailableError"
  }
}

interface TrendDbRow {
  id: string
  slug: string
  status: TrendStatus
  tags: string[] | null
  badges: string[] | null
  sort_order: number
  draft_version: number
  published_version: number | null
  created_at: string
  updated_at: string
}

function toTrendRow(r: TrendDbRow): TrendRow {
  return {
    id: r.id,
    slug: r.slug,
    status: r.status,
    tags: r.tags ?? [],
    badges: (r.badges ?? []) as TrendBadge[],
    sortOrder: r.sort_order,
    draftVersion: r.draft_version,
    publishedVersion: r.published_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function fail(what: string, error: { code?: string | null; message?: string }): never {
  if (isMissingTableError(error)) throw new TrendsUnavailableError()
  throw new Error(`Could not ${what}: ${error.message ?? "unknown error"}`)
}

const now = () => new Date().toISOString()

async function readTrend(column: "id" | "slug", value: string): Promise<TrendRow | null> {
  const { data, error } = await supabase.from("trends").select(TREND_COLS).eq(column, value).maybeSingle()
  if (error) fail(`read trend ${value}`, error)
  return data ? toTrendRow(data as TrendDbRow) : null
}

export function getTrendBySlug(slug: string): Promise<TrendRow | null> {
  return readTrend("slug", slug)
}

export function getTrendById(id: string): Promise<TrendRow | null> {
  return readTrend("id", id)
}

async function requireTrend(trendId: string): Promise<TrendRow> {
  const trend = await getTrendById(trendId)
  if (!trend) throw new TrendNotFoundError(trendId)
  return trend
}

export async function getVersion(trendId: string, version: number): Promise<TrendVersionData | null> {
  const { data, error } = await supabase
    .from("trend_versions")
    .select("data")
    .eq("trend_id", trendId)
    .eq("version", version)
    .maybeSingle()
  if (error) fail(`read trend ${trendId} version ${version}`, error)
  return data ? ((data as { data: TrendVersionData }).data) : null
}

/**
 * The draft changed after the caller read it (its revision, or the draft
 * version itself, moved): the write was refused. The caller re-reads.
 */
export class DraftConflictError extends Error {
  constructor(readonly trendId: string) {
    super(`Trend ${trendId}'s draft changed since it was read; reload it and try again.`)
    this.name = "DraftConflictError"
  }
}

/** A version row's write token: a new one on every write of its data. */
const newRevision = () => randomUUID()

/**
 * Overwrite a version's data, only while it has never been published (and,
 * with `expected`, only while its revision is still `expected`). True when a
 * row was written.
 */
async function writeUnpublished(
  trendId: string,
  version: number,
  data: TrendVersionData,
  revision: string,
  expected?: string,
): Promise<boolean> {
  let query = supabase
    .from("trend_versions")
    .update({ data, revision })
    .eq("trend_id", trendId)
    .eq("version", version)
    .is("published_at", null)
  if (expected !== undefined) query = query.eq("revision", expected)
  const { data: rows, error } = await query.select("version")
  if (error) fail(`save trend ${trendId} version ${version}`, error)
  return (rows ?? []).length > 0
}

/** Whether a version row exists, whether it was ever published, and its revision. */
async function versionState(
  trendId: string,
  version: number,
): Promise<{ state: "missing" | "draft" | "published"; revision?: string }> {
  const { data, error } = await supabase
    .from("trend_versions")
    .select("published_at, revision")
    .eq("trend_id", trendId)
    .eq("version", version)
    .maybeSingle()
  if (error) fail(`read trend ${trendId} version ${version}`, error)
  if (!data) return { state: "missing" }
  const row = data as { published_at: string | null; revision?: string | null }
  return {
    state: row.published_at ? "published" : "draft",
    ...(typeof row.revision === "string" ? { revision: row.revision } : {}),
  }
}

/** The trend, its draft version's data and that row's revision; null when there is no such trend. */
export async function getDraftState(
  trendId: string,
): Promise<{ trend: TrendRow; data: TrendVersionData; revision: string } | null> {
  const trend = await getTrendById(trendId)
  if (!trend) return null
  const { data, error } = await supabase
    .from("trend_versions")
    .select("data, revision")
    .eq("trend_id", trendId)
    .eq("version", trend.draftVersion)
    .maybeSingle()
  if (error) fail(`read trend ${trendId} version ${trend.draftVersion}`, error)
  if (!data) throw new Error(`Trend ${trendId} has no draft version ${trend.draftVersion}.`)
  const row = data as { data: TrendVersionData; revision: string }
  return { trend, data: row.data, revision: row.revision }
}

/**
 * How old a never-pointed-at version + 1 row must be before a GUARDED save may
 * reclaim it as a crashed writer's leftover. A younger one may belong to a
 * writer that is still between its insert and its pointer move.
 */
export const ORPHAN_VERSION_MIN_AGE_MS = 10 * 60 * 1000

/**
 * A guarded save found version `next` already there (23505): reclaim it only
 * when it is a crashed writer's leftover — the pointer is still at `from`, the
 * row is unpublished and older than {@link ORPHAN_VERSION_MIN_AGE_MS} — and
 * only through an update conditional on the revision just read, the row's
 * age and `published_at IS NULL` (it also restamps `created_at`, so a second
 * reclaimer's conditions fail). Anything else may be a concurrent writer's
 * row: refused, nothing written.
 */
async function reclaimOrphan(trendId: string, from: number, next: number, data: TrendVersionData, revision: string): Promise<void> {
  const trend = await requireTrend(trendId)
  if (trend.draftVersion !== from) throw new DraftConflictError(trendId)
  const { data: row, error } = await supabase
    .from("trend_versions")
    .select("revision, published_at, created_at")
    .eq("trend_id", trendId)
    .eq("version", next)
    .maybeSingle()
  if (error) fail(`read trend ${trendId} version ${next}`, error)
  const r = row as { revision?: string | null; published_at?: string | null; created_at?: string | null } | null
  const cutoff = new Date(Date.now() - ORPHAN_VERSION_MIN_AGE_MS).toISOString()
  const createdAt = r?.created_at ? Date.parse(r.created_at) : NaN
  if (!r || r.published_at || typeof r.revision !== "string" || !(createdAt < Date.parse(cutoff))) {
    throw new DraftConflictError(trendId)
  }
  const { data: rows, error: updateError } = await supabase
    .from("trend_versions")
    .update({ data, revision, created_at: now() })
    .eq("trend_id", trendId)
    .eq("version", next)
    .eq("revision", r.revision)
    .is("published_at", null)
    .lt("created_at", cutoff)
    .select("version")
  if (updateError) fail(`save trend ${trendId} version ${next}`, updateError)
  if ((rows ?? []).length === 0) throw new DraftConflictError(trendId)
}

/**
 * Write `data` as version `from + 1` and move the draft pointer to it, guarded
 * on the pointer still being `from`. Null when a concurrent write got there
 * first (the caller re-reads).
 *
 * `guarded` (a save with an expected revision) never overwrites a version + 1
 * row another writer may own: see {@link reclaimOrphan}. Unguarded, an
 * existing unpublished row is reused as before (last writer wins).
 */
async function copyForward(
  trendId: string,
  from: number,
  data: TrendVersionData,
  guarded: boolean,
): Promise<{ version: number; revision: string } | null> {
  const next = from + 1
  const revision = newRevision()
  const { error: insertError } = await supabase.from("trend_versions").insert({ trend_id: trendId, version: next, data, revision })
  if (insertError) {
    // 23505: the row is already there — an earlier save wrote it but did not
    // move the pointer, or a concurrent save is doing the same.
    if (insertError.code !== "23505") fail(`save trend ${trendId} version ${next}`, insertError)
    if (guarded) await reclaimOrphan(trendId, from, next, data, revision)
    else if (!(await writeUnpublished(trendId, next, data, revision))) return null
  }
  const { data: moved, error } = await supabase
    .from("trends")
    .update({ draft_version: next, updated_at: now() })
    .eq("id", trendId)
    .eq("draft_version", from)
    .select("id")
  if (error) fail(`move trend ${trendId} to draft version ${next}`, error)
  return (moved ?? []).length > 0 ? { version: next, revision } : null
}

/**
 * Save the admin's draft. While the draft is the published version, the data
 * goes into a NEW version (draft + 1) and the draft pointer moves to it; the
 * published row is never touched. Otherwise the draft row is edited in place.
 *
 * `expectedRevision` (the revision the caller read with the draft) makes the
 * write conditional: should the draft have been written since (or moved to
 * another version), it throws `DraftConflictError` and writes nothing.
 * Without it, the save is last-writer-wins and retries on a moving pointer.
 */
export async function saveDraft(
  trendId: string,
  data: TrendVersionData,
  opts: { expectedRevision?: string } = {},
): Promise<{ version: number; revision: string }> {
  const expected = opts.expectedRevision
  let lastVersion = 0
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const trend = await requireTrend(trendId)
    const draft = trend.draftVersion
    lastVersion = draft

    if (trend.publishedVersion === draft) {
      // A published row never changes, so its revision is what the caller read, or it is not.
      if (expected !== undefined && (await versionState(trendId, draft)).revision !== expected) {
        throw new DraftConflictError(trendId)
      }
      const saved = await copyForward(trendId, draft, data, expected !== undefined)
      if (saved) return saved
      if (expected !== undefined) throw new DraftConflictError(trendId)
      continue // a concurrent save moved the draft first: re-read
    }

    // A draft ahead of the published version (or never published), edited in
    // place — guarded, so a row published since the read is never rewritten.
    const revision = newRevision()
    if (await writeUnpublished(trendId, draft, data, revision, expected)) {
      const { error } = await supabase.from("trends").update({ updated_at: now() }).eq("id", trendId)
      if (error) fail(`touch trend ${trendId}`, error)
      return { version: draft, revision }
    }
    const state = await versionState(trendId, draft)
    if (state.state === "missing") throw new Error(`Could not save trend ${trendId}: it has no draft version ${draft}.`)
    if (expected !== undefined && state.revision !== expected) throw new DraftConflictError(trendId)
    if (state.state === "published") {
      // Stamped but not pointed at: a publish that failed (or is running)
      // between its two writes. That row is frozen, so copy forward from it.
      const saved = await copyForward(trendId, draft, data, expected !== undefined)
      if (saved) return saved
      if (expected !== undefined) throw new DraftConflictError(trendId)
    }
  }
  throw new Error(`Could not save trend ${trendId} draft version ${lastVersion}: it kept changing during the save; try again.`)
}

/**
 * Publish the draft: stamp its version row's `published_at` (which also makes
 * that row immutable) and point `published_version` at it.
 *
 * `expected` (the draft version and revision the caller checked) makes it
 * conditional: should the draft have moved or been written since, nothing is
 * published and it throws `DraftConflictError`. The stamp is guarded on the
 * revision, and a stamped row is never written again, so what is published is
 * exactly what was checked.
 */
export async function publish(trendId: string, expected?: { version: number; revision: string }): Promise<void> {
  const trend = await requireTrend(trendId)
  const version = trend.draftVersion
  if (expected && expected.version !== version) throw new DraftConflictError(trendId)

  let stamp = supabase
    .from("trend_versions")
    .update({ published_at: now() })
    .eq("trend_id", trendId)
    .eq("version", version)
  if (expected) stamp = stamp.eq("revision", expected.revision)
  const { data: stamped, error: stampError } = await stamp.select("version")
  if (stampError) fail(`publish trend ${trendId} version ${version}`, stampError)
  if ((stamped ?? []).length === 0) {
    if (expected && (await versionState(trendId, version)).state !== "missing") throw new DraftConflictError(trendId)
    throw new Error(`Could not publish trend ${trendId}: it has no version ${version}.`)
  }

  const { data: moved, error } = await supabase
    .from("trends")
    .update({ status: "published", published_version: version, updated_at: now() })
    .eq("id", trendId)
    .eq("draft_version", version)
    .select("id")
  if (error) fail(`publish trend ${trendId}`, error)
  // A save copied the (now published) draft to version + 1 between the two
  // writes; the stamped version is not what the admin sees any more.
  if ((moved ?? []).length === 0) {
    if (expected) throw new DraftConflictError(trendId)
    throw new Error(`Could not publish trend ${trendId}: its draft changed while publishing; try again.`)
  }
}

/** Take a published trend off the catalog. `published_version` is kept. */
export async function unpublish(trendId: string): Promise<void> {
  const trend = await requireTrend(trendId)
  if (trend.status !== "published") return
  const { error } = await supabase
    .from("trends")
    .update({ status: "unpublished", updated_at: now() })
    .eq("id", trendId)
    .eq("status", "published")
  if (error) fail(`unpublish trend ${trendId}`, error)
}

/**
 * Put a trend away (migration 559): off the catalog whatever its status, with
 * its versions, favorites and runs kept. Archiving an archived trend is a no-op.
 */
export async function archive(trendId: string): Promise<void> {
  const trend = await requireTrend(trendId)
  if (trend.status === "archived") return
  const { error } = await supabase
    .from("trends")
    .update({ status: "archived", updated_at: now() })
    .eq("id", trendId)
    .neq("status", "archived")
  if (error) fail(`archive trend ${trendId}`, error)
}

/**
 * Bring an archived trend back, unpublished: `unpublished` when it was ever
 * published (its `published_version` is kept), else `draft`. Publishing it is
 * a separate, deliberate step. Restoring a trend that is not archived is a no-op.
 */
export async function restore(trendId: string): Promise<void> {
  const trend = await requireTrend(trendId)
  if (trend.status !== "archived") return
  const { error } = await supabase
    .from("trends")
    .update({ status: trend.publishedVersion != null ? "unpublished" : "draft", updated_at: now() })
    .eq("id", trendId)
    .eq("status", "archived")
  if (error) fail(`restore trend ${trendId}`, error)
}

// ── Display copies (S7 backfill) ──────────────────────────────────────────

export type DisplayAttachConflict = "source_changed" | "source_removed" | "version_missing" | "concurrent_write"

const CONFLICT_TEXT: Record<DisplayAttachConflict, string> = {
  source_changed: "its source clip changed since the copy was made",
  source_removed: "its source clip was removed since the copy was made",
  version_missing: "the version is gone (its trend was deleted?)",
  concurrent_write: "it kept changing while the display copy was attached",
}

/** The row moved under a display copy (its source replaced or removed, the row gone, or it kept being written). Nothing was written. */
export class DisplayAttachConflictError extends Error {
  constructor(readonly trendId: string, readonly version: number, readonly reason: DisplayAttachConflict) {
    super(`Trend ${trendId} version ${version}: ${CONFLICT_TEXT[reason]}.`)
    this.name = "DisplayAttachConflictError"
  }
}

/**
 * Attach `display` as `data.source.display` of one version row — published or
 * draft — where it has none: the documented exception to "a published version
 * is never written" (header), because it only adds derived display media and
 * never changes what a run uses. `"already"` when the row has one (nothing is
 * written, the existing copy wins).
 *
 * PostgREST cannot set one JSON key, so the row is read and its whole `data`
 * written back, `{ ...data, source: { ...source, display } }` and nothing else.
 * The write is a compare-and-set on what was read: `revision` unchanged (every
 * other data write sets a new one, so an admin save in between makes it match
 * nothing) and `data->source->>display` still absent (two backfills at once:
 * the second matches nothing). It sets neither `revision` nor `published_at`,
 * so a publish checked against the revision an admin read still goes through.
 * A write that matched nothing is re-read and retried; `sourceVideoUrl` (the
 * clip the copy was made from) refuses a row whose source was replaced since.
 */
export async function attachDisplayCopy(
  trendId: string,
  version: number,
  display: TrendSourceDisplay,
  opts: { sourceVideoUrl?: string } = {},
): Promise<"set" | "already"> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: row, error } = await supabase
      .from("trend_versions")
      .select("data, revision")
      .eq("trend_id", trendId)
      .eq("version", version)
      .maybeSingle()
    if (error) fail(`read trend ${trendId} version ${version}`, error)
    if (!row) throw new DisplayAttachConflictError(trendId, version, "version_missing")
    const { data, revision } = row as { data: TrendVersionData; revision: string }
    const source = data.source
    if (!source) throw new DisplayAttachConflictError(trendId, version, "source_removed")
    if (source.display) return "already"
    if (opts.sourceVideoUrl !== undefined && source.videoUrl !== opts.sourceVideoUrl) {
      throw new DisplayAttachConflictError(trendId, version, "source_changed")
    }
    if (display.videoUrl === source.videoUrl) {
      throw new Error(`Trend ${trendId} version ${version}: the display copy must be its own file, never the source clip.`)
    }
    if (![display.videoUrl, display.posterUrl].every((u) => /^https?:\/\//i.test(u))) {
      throw new Error(`Trend ${trendId} version ${version}: the display copy's addresses must be http(s) (is R2_PUBLIC_URL set?).`)
    }

    const next: TrendVersionData = { ...data, source: { ...source, display } }
    const { data: written, error: writeError } = await supabase
      .from("trend_versions")
      .update({ data: next })
      .eq("trend_id", trendId)
      .eq("version", version)
      .eq("revision", revision)
      .is("data->source->>display", null)
      .select("version")
    if (writeError) fail(`attach a display copy to trend ${trendId} version ${version}`, writeError)
    if ((written ?? []).length > 0) return "set"
  }
  throw new DisplayAttachConflictError(trendId, version, "concurrent_write")
}

/** A version with a source clip and no `display` (`slug` null: no trend row found; `published`: `published_at` set). */
export interface VersionLackingDisplay { trendId: string; slug: string | null; version: number; published: boolean; sourceVideoUrl: string }

const LACKING_PAGE = 500

/**
 * Every version row with a source clip and no display copy, published or
 * draft (a draft without one cannot publish either), in (trend, version)
 * order, all pages read before it returns. The database filters by JSON path
 * (`->>`, so a JSON `null` source counts as none); the rows are checked again
 * here.
 */
export async function listVersionsLackingDisplay(): Promise<VersionLackingDisplay[]> {
  const rows: Array<{ trend_id: string; version: number; published_at: string | null; source: TrendVersionData["source"] }> = []
  for (let from = 0; ; from += LACKING_PAGE) {
    const { data, error } = await supabase
      .from("trend_versions")
      .select("trend_id, version, published_at, source:data->source")
      .not("data->>source", "is", null)
      .is("data->source->>display", null)
      .order("trend_id", { ascending: true })
      .order("version", { ascending: true })
      .range(from, from + LACKING_PAGE - 1)
    if (error) fail("list trend versions lacking a display copy", error)
    const page = (data ?? []) as typeof rows
    rows.push(...page)
    if (page.length < LACKING_PAGE) break
  }
  const lacking = rows.filter((r) => r.source && typeof r.source.videoUrl === "string" && !r.source.display)
  if (lacking.length === 0) return []

  const slugs = new Map<string, string>()
  const ids = [...new Set(lacking.map((r) => r.trend_id))]
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("trends").select("id, slug").in("id", ids.slice(i, i + 100))
    if (error) fail("read trend slugs", error)
    for (const t of (data ?? []) as Array<{ id: string; slug: string }>) slugs.set(t.id, t.slug)
  }
  return lacking.map((r) => ({
    trendId: r.trend_id,
    slug: slugs.get(r.trend_id) ?? null,
    version: r.version,
    published: r.published_at !== null,
    sourceVideoUrl: r.source!.videoUrl,
  }))
}

// ── Preview input clips (backfill) ────────────────────────────────────────

export type PreviewClipAttachConflict = "source_changed" | "start_changed" | "not_offered" | "version_missing" | "concurrent_write"

const CLIP_CONFLICT_TEXT: Record<PreviewClipAttachConflict, string> = {
  source_changed: "its source clip changed since the preview clip was cut",
  start_changed: "its preview start moved since the preview clip was cut",
  not_offered: "it offers no preview (or has no source clip) since the preview clip was cut",
  version_missing: "the version is gone (its trend was deleted?)",
  concurrent_write: "it kept changing while the preview clip was attached",
}

/** The row moved under a preview clip (its source or start changed, the preview turned off, the row gone, or it kept being written). Nothing was written. */
export class PreviewClipAttachConflictError extends Error {
  constructor(readonly trendId: string, readonly version: number, readonly reason: PreviewClipAttachConflict) {
    super(`Trend ${trendId} version ${version}: ${CLIP_CONFLICT_TEXT[reason]}.`)
    this.name = "PreviewClipAttachConflictError"
  }
}

/**
 * Attach `clip` as `data.previewClip` of one version row — published or draft
 * — where it has none: the second documented exception to "a published
 * version is never written" (header), because a preview run of that version
 * then edits the stored cut of the SAME window it would otherwise cut itself.
 * `"already"` when the row has one (nothing is written, the existing clip
 * wins: a run of a published version must keep editing the same bytes).
 *
 * As `attachDisplayCopy`: the row is read and its whole `data` written back,
 * `{ ...data, previewClip: clip }` and nothing else, as a compare-and-set on
 * the `revision` read and on `data->>previewClip` still absent, setting
 * neither `revision` nor `published_at`. The clip must have been cut from the
 * row's source at the row's `previewStart` (`clip.sourceVideoUrl`,
 * `clip.startSec`): a row whose source or start moved since is refused, and
 * so is one that offers no preview any more.
 */
export async function attachPreviewClip(trendId: string, version: number, clip: TrendPreviewClip): Promise<"set" | "already"> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data: row, error } = await supabase
      .from("trend_versions")
      .select("data, revision")
      .eq("trend_id", trendId)
      .eq("version", version)
      .maybeSingle()
    if (error) fail(`read trend ${trendId} version ${version}`, error)
    if (!row) throw new PreviewClipAttachConflictError(trendId, version, "version_missing")
    const { data, revision } = row as { data: TrendVersionData; revision: string }
    if (data.previewClip) return "already"
    if (!data.source || data.previewStart === null) throw new PreviewClipAttachConflictError(trendId, version, "not_offered")
    if (data.source.videoUrl !== clip.sourceVideoUrl) throw new PreviewClipAttachConflictError(trendId, version, "source_changed")
    if (data.previewStart !== clip.startSec) throw new PreviewClipAttachConflictError(trendId, version, "start_changed")
    if (clip.videoUrl === data.source.videoUrl) {
      throw new Error(`Trend ${trendId} version ${version}: the preview clip must be its own file, never the source clip.`)
    }
    if (![clip.videoUrl, ...(clip.faceMask ? [clip.faceMask.url] : [])].every((u) => /^https?:\/\//i.test(u))) {
      throw new Error(`Trend ${trendId} version ${version}: the preview clip's addresses must be http(s) (is R2_PUBLIC_URL set?).`)
    }

    const next: TrendVersionData = { ...data, previewClip: clip }
    const { data: written, error: writeError } = await supabase
      .from("trend_versions")
      .update({ data: next })
      .eq("trend_id", trendId)
      .eq("version", version)
      .eq("revision", revision)
      .is("data->>previewClip", null)
      .select("version")
    if (writeError) fail(`attach a preview clip to trend ${trendId} version ${version}`, writeError)
    if ((written ?? []).length > 0) return "set"
  }
  throw new PreviewClipAttachConflictError(trendId, version, "concurrent_write")
}

/** A version that offers a preview and has no `previewClip` (`slug` null: no trend row found; `published`: `published_at` set). */
export interface VersionLackingPreviewClip {
  trendId: string
  slug: string | null
  version: number
  published: boolean
  /** What to cut: the version's own source, start and current stored face mask (`storedFaceMaskFor`, resolved by the caller). */
  data: TrendVersionData
}

/**
 * Every version row with a source clip, a preview offered (`previewStart` not
 * null) and no preview clip, published or draft (a draft without one cannot
 * publish either), in (trend, version) order, all pages read before it
 * returns. The database filters by JSON path (`->>`, so a JSON `null` counts
 * as none); the rows are checked again here. Only the versions a run can
 * reach matter in practice (the published ones); drafts are listed so the
 * next publish does not have to cut.
 */
export async function listVersionsLackingPreviewClip(): Promise<VersionLackingPreviewClip[]> {
  const rows: Array<{ trend_id: string; version: number; published_at: string | null; data: TrendVersionData }> = []
  for (let from = 0; ; from += LACKING_PAGE) {
    const { data, error } = await supabase
      .from("trend_versions")
      .select("trend_id, version, published_at, data")
      .not("data->>source", "is", null)
      .not("data->>previewStart", "is", null)
      .is("data->>previewClip", null)
      .order("trend_id", { ascending: true })
      .order("version", { ascending: true })
      .range(from, from + LACKING_PAGE - 1)
    if (error) fail("list trend versions lacking a preview clip", error)
    const page = (data ?? []) as typeof rows
    rows.push(...page)
    if (page.length < LACKING_PAGE) break
  }
  const lacking = rows.filter((r) => r.data?.source && typeof r.data.source.videoUrl === "string" && typeof r.data.previewStart === "number" && !r.data.previewClip)
  if (lacking.length === 0) return []

  const slugs = new Map<string, string>()
  const ids = [...new Set(lacking.map((r) => r.trend_id))]
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabase.from("trends").select("id, slug").in("id", ids.slice(i, i + 100))
    if (error) fail("read trend slugs", error)
    for (const t of (data ?? []) as Array<{ id: string; slug: string }>) slugs.set(t.id, t.slug)
  }
  return lacking.map((r) => ({
    trendId: r.trend_id,
    slug: slugs.get(r.trend_id) ?? null,
    version: r.version,
    published: r.published_at !== null,
    data: r.data,
  }))
}

// ── Admin writes ──────────────────────────────────────────────────────────

/** Another trend already has this slug. */
export class TrendSlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`The slug "${slug}" is taken.`)
    this.name = "TrendSlugTakenError"
  }
}

/**
 * A new draft trend: its `trends` row and its version 1 (`data`, already
 * validated by the caller). Should the version insert fail, the trend row is
 * removed again, so a trend never exists without its draft version.
 */
export async function createTrend(input: { slug: string; data: TrendVersionData; createdBy?: string }): Promise<{ id: string }> {
  const { data: row, error } = await supabase
    .from("trends")
    .insert({ slug: input.slug, status: "draft", draft_version: 1, ...(input.createdBy ? { created_by: input.createdBy } : {}) })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23505") throw new TrendSlugTakenError(input.slug)
    fail(`create trend ${input.slug}`, error)
  }
  const id = (row as { id: string }).id
  const { error: versionError } = await supabase.from("trend_versions").insert({ trend_id: id, version: 1, data: input.data })
  if (versionError) {
    const { error: undoError } = await supabase.from("trends").delete().eq("id", id)
    if (undoError) console.error(`[trends] could not remove trend ${id} after its version 1 failed:`, undoError)
    fail(`create trend ${input.slug} version 1`, versionError)
  }
  return { id }
}

/** Every trend (any status) in the catalog's order, each with its DRAFT version's data (null when that row is missing). */
export async function listAllTrends(): Promise<Array<TrendRow & { draft: TrendVersionData | null }>> {
  const { data, error } = await supabase
    .from("trends")
    .select(TREND_COLS)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
  if (error) fail("list trends", error)
  const rows = ((data ?? []) as TrendDbRow[]).map(toTrendRow)
  if (rows.length === 0) return []

  const { data: versions, error: versionsError } = await supabase
    .from("trend_versions")
    .select("trend_id, version, data")
    .or(rows.map((t) => `and(trend_id.eq.${t.id},version.eq.${t.draftVersion})`).join(","))
  if (versionsError) fail("read trend draft versions", versionsError)
  const byKey = new Map<string, TrendVersionData>()
  for (const v of (versions ?? []) as Array<{ trend_id: string; version: number; data: TrendVersionData }>) {
    byKey.set(`${v.trend_id}:${v.version}`, v.data)
  }
  return rows.map((t) => ({ ...t, draft: byKey.get(`${t.id}:${t.draftVersion}`) ?? null }))
}

/** Change a trend's catalog fields (never its versions). Null when there is no such trend. */
export async function updateTrendMeta(
  trendId: string,
  patch: { slug?: string; tags?: string[]; badges?: TrendBadge[]; sortOrder?: number },
): Promise<TrendRow | null> {
  const update: Record<string, unknown> = { updated_at: now() }
  if (patch.slug !== undefined) update.slug = patch.slug
  if (patch.tags !== undefined) update.tags = patch.tags
  if (patch.badges !== undefined) update.badges = patch.badges
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder
  const { data, error } = await supabase.from("trends").update(update).eq("id", trendId).select(TREND_COLS).maybeSingle()
  if (error) {
    if (error.code === "23505" && patch.slug !== undefined) throw new TrendSlugTakenError(patch.slug)
    fail(`update trend ${trendId}`, error)
  }
  return data ? toTrendRow(data as TrendDbRow) : null
}

// ── The public catalog ────────────────────────────────────────────────────

interface Keyset { sortOrder: number; id: string }

export function encodeTrendCursor(k: Keyset): string {
  return Buffer.from(JSON.stringify([k.sortOrder, k.id]), "utf8").toString("base64url")
}

export function decodeTrendCursor(raw: string): Keyset | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [sortOrder, id] = parsed
    if (!Number.isSafeInteger(sortOrder)) return null
    if (typeof id !== "string" || !UUID_RE.test(id)) return null
    return { sortOrder, id }
  } catch {
    return null
  }
}

/**
 * A one-element Postgres array literal for `contains`. supabase-js joins an
 * array value into `{a,b}` unquoted, so user text holding `,` `{` `}` or `"`
 * would turn into several tags or a malformed literal; quoted, it is one tag.
 */
function oneTagLiteral(tag: string): string {
  return `{"${tag.replace(/["\\]/g, (c) => `\\${c}`)}"}`
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Published trends whose PUBLISHED name (any language) contains `q`, or
 * that carry `q` as a tag. Resolved to ids before paging, so a page is never
 * cut short by a filter applied after it was fetched.
 */
async function trendIdsMatching(q: string): Promise<string[]> {
  const needle = q.trim()
  const lower = needle.toLocaleLowerCase()

  const [nameHits, tagHits] = await Promise.all([
    // `data->>name` is the name object as JSON text: every language in one
    // ilike. A hit on a key or on JSON punctuation is dropped below.
    supabase
      .from("trend_versions")
      .select("trend_id, version, name:data->name")
      .not("published_at", "is", null)
      .ilike("data->>name", `%${escapeLike(needle)}%`),
    supabase.from("trends").select("id").eq("status", "published").contains("tags", oneTagLiteral(needle)),
  ])
  if (nameHits.error) fail("search trend names", nameHits.error)
  if (tagHits.error) fail("search trend tags", tagHits.error)

  const versionsById = new Map<string, Set<number>>()
  for (const row of (nameHits.data ?? []) as Array<{ trend_id: string; version: number; name: unknown }>) {
    const values = row.name && typeof row.name === "object" ? Object.values(row.name) : []
    if (!values.some((v) => typeof v === "string" && v.toLocaleLowerCase().includes(lower))) continue
    const set = versionsById.get(row.trend_id) ?? new Set<number>()
    set.add(row.version)
    versionsById.set(row.trend_id, set)
  }

  const ids = new Set<string>(((tagHits.data ?? []) as Array<{ id: string }>).map((r) => r.id))
  if (versionsById.size > 0) {
    const { data, error } = await supabase
      .from("trends")
      .select("id, published_version")
      .eq("status", "published")
      .in("id", [...versionsById.keys()])
    if (error) fail("search trend names", error)
    for (const r of (data ?? []) as Array<{ id: string; published_version: number | null }>) {
      // Only the version users see counts: a draft's new name does not.
      if (r.published_version !== null && versionsById.get(r.id)?.has(r.published_version)) ids.add(r.id)
    }
  }
  return [...ids]
}

async function favoriteTrendIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("trend_favorites").select("trend_id").eq("user_id", userId)
  if (error) fail("read favorites", error)
  return ((data ?? []) as Array<{ trend_id: string }>).map((r) => r.trend_id)
}

/**
 * One page of the published catalog in `sort_order, id` order, each trend
 * with its PUBLISHED version's data. `q` matches a name in any language or a
 * whole tag; `tag` is `tags @> [tag]`; `favoritesOf` keeps that user's
 * favorites. Throws `InvalidTrendCursorError` for a cursor it did not issue.
 */
export async function listPublished(q: {
  q?: string
  tag?: string
  favoritesOf?: string
  cursor?: string
  limit: number
}): Promise<{ rows: Array<TrendRow & { data: TrendVersionData }>; next: string | null }> {
  const after = q.cursor ? decodeTrendCursor(q.cursor) : null
  if (q.cursor && !after) throw new InvalidTrendCursorError()

  let only: string[] | null = null
  if (q.favoritesOf) only = await favoriteTrendIds(q.favoritesOf)
  if (q.q?.trim() && (only === null || only.length > 0)) {
    const hits = await trendIdsMatching(q.q)
    only = only === null ? hits : only.filter((id) => hits.includes(id))
  }
  if (only !== null && only.length === 0) return { rows: [], next: null }

  let query = supabase.from("trends").select(TREND_COLS).eq("status", "published")
  if (q.tag) query = query.contains("tags", oneTagLiteral(q.tag))
  if (only !== null) query = query.in("id", only)
  // Both values are this server's own (a safe integer and a UUID), never raw input.
  if (after) query = query.or(`sort_order.gt.${after.sortOrder},and(sort_order.eq.${after.sortOrder},id.gt.${after.id})`)
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true })
    .limit(q.limit + 1)
  if (error) fail("list trends", error)

  const all = ((data ?? []) as TrendDbRow[]).map(toTrendRow)
  const page = all.slice(0, q.limit)
  const last = page[page.length - 1]
  const next = all.length > q.limit && last ? encodeTrendCursor({ sortOrder: last.sortOrder, id: last.id }) : null

  const pairs = page.filter((t) => t.publishedVersion !== null)
  if (pairs.length === 0) return { rows: [], next }
  const { data: versions, error: versionsError } = await supabase
    .from("trend_versions")
    .select("trend_id, version, data")
    .or(pairs.map((t) => `and(trend_id.eq.${t.id},version.eq.${t.publishedVersion})`).join(","))
  if (versionsError) fail("read published trend versions", versionsError)

  const byKey = new Map<string, TrendVersionData>()
  for (const v of (versions ?? []) as Array<{ trend_id: string; version: number; data: TrendVersionData }>) {
    byKey.set(`${v.trend_id}:${v.version}`, v.data)
  }
  const rows = pairs.flatMap((t) => {
    const d = byKey.get(`${t.id}:${t.publishedVersion}`)
    return d ? [{ ...t, data: d }] : []
  })
  return { rows, next }
}

// ── Favorites ─────────────────────────────────────────────────────────────

export async function setFavorite(userId: string, trendId: string, on: boolean): Promise<void> {
  if (on) {
    // ignoreDuplicates keeps the first created_at (the favorites list's order).
    const { error } = await supabase
      .from("trend_favorites")
      .upsert({ user_id: userId, trend_id: trendId }, { onConflict: "user_id,trend_id", ignoreDuplicates: true })
    if (error) fail("save favorite", error)
    return
  }
  const { error } = await supabase.from("trend_favorites").delete().eq("user_id", userId).eq("trend_id", trendId)
  if (error) fail("remove favorite", error)
}

/** Which of `trendIds` the user has favorited. */
export async function favoriteIds(userId: string, trendIds: string[]): Promise<Set<string>> {
  if (trendIds.length === 0) return new Set()
  const { data, error } = await supabase
    .from("trend_favorites")
    .select("trend_id")
    .eq("user_id", userId)
    .in("trend_id", trendIds)
  if (error) fail("read favorites", error)
  return new Set(((data ?? []) as Array<{ trend_id: string }>).map((r) => r.trend_id))
}
