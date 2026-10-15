import { config } from "./config.js"
import { supabase } from "./supabase.js"
import { isOwnedObjectKey, objectKeyJobIdCandidates } from "./job-policy-outputs.js"
import { relayPossible } from "./relay-possible.js"

/** The client the lookups read with: the backend's service role, or a test's stand-in. */
type LookupClient = Pick<typeof supabase, "from">

/**
 * WHOSE OBJECT IS THIS? The question every storage deleter asks before it
 * deletes a key on a user's behalf (decided 2026-10-06), and every writer asks
 * before it records a url a caller names (decided 2026-10-15).
 *
 * A deleter finds its keys in rows: an `assets` row, a location's url
 * columns, a job's output, a run's node states. Rows say where a file is; they
 * do not say whose it is. Before migration 480 a browser could insert an
 * `assets` row or write a location naming any key, and API paths stored a url
 * the caller named (a library save, a pipeline entity's upload). So a reaper
 * or a permanent delete that trusted the row deleted whatever the row named.
 *
 * THE ALLOW PROOF (decided 2026-10-15). An object is a user's only when the
 * platform recorded that user as its maker:
 *   - its key family (`<prefix>/<jobId>` or `<prefix>/<jobId>-<suffix>`,
 *     `isOwnedObjectKey`): the job that wrote it, and that job's user. Jobs
 *     are server-written since migration 474, and a job id cannot be reused,
 *     so this is the strongest proof there is.
 *   - a per-user folder the server mints (`USER_NAMESPACE_RE`): the MCP
 *     upload tools' `uploads/<kind>/<userId>/...` (and `uploads/handoff/...`),
 *     community clones' `user-clones/<userId>/...`, timeline exports'
 *     `exports/<userId>/...`.
 *   - on an instance that relays with a shared bucket, one of the user's
 *     relayed jobs whose far-end job id is the key's stem
 *     (`jobs.relay_job_id`, asked only when a relay is possible).
 *   - the user's ORIGIN row: the `assets` row a server path wrote for the user
 *     when it stored the bytes. Most keys carry no maker in their name —
 *     `POST /v1/upload` writes `uploads/<kind>s/<uuid>.<ext>`; imports, social
 *     downloads, scraped media and processed files have shapes of their own —
 *     and the row the storing path wrote is their only record. So is the
 *     worker's row for an output whose job was since deleted from history
 *     (`assets.job_id` is ON DELETE SET NULL). A row that only RECORDS a url
 *     someone named (`isRecordedReference`) proves nothing.
 * Maker evidence wins: an object another user's job made, or that sits in
 * another user's namespace, is not this user's whatever rows they hold.
 *
 * "Claimed by another user" is the deny side, as before: another user's job
 * made it, it sits in their namespace, or a library row of theirs names it
 * (deleting it would break their library item).
 *
 * Ingestion and deletion ask through the same judgment (`judgeKeys`):
 *   - a writer recording a url a caller names (`judgeUrlForRecording`)
 *     records an object of ours only when the caller provably owns it;
 *   - a deleter (`keysUserMayDelete`, `ownKeysOnly`, `judgeAssetRowDelete`)
 *     deletes an object only when the user provably owns it AND nobody else
 *     claims it. Anything else stays in storage and only the user's row goes:
 *     an object no record ties to the user — an operator file, a plugin cache,
 *     a row-less output, an output whose job and size are both gone — is never
 *     deleted on their behalf. Keeping can be revisited; an R2 delete cannot.
 *
 * ERROR POLICY: a failed lookup THROWS. A caller that cannot ask must not
 * delete and must not record. Reapers count the error and stop the batch;
 * interactive deletes keep the object and still remove the row; a writer
 * answers 500.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The per-user key folders the server mints, the user's id as a folder: the
 * MCP upload tools' (`uploads/<kind>/<userId>/…` and `uploads/handoff/…`,
 * lib/mcp/tools/upload.ts), the community library's clones
 * (`user-clones/<userId>/…`, ee/services/community/clone.ts) and timeline
 * exports (`exports/<userId>/…`, ee/pipelines/_freecut-timeline.ts).
 */
const USER_NAMESPACE_RE =
  /^(?:uploads\/(?:handoff\/)?[^/]+|user-clones|exports)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i

const LOOKUP_CHUNK = 100

/** The user whose namespace this key sits in, if it sits in one. */
export function keyNamespaceOwner(key: string): string | null {
  const m = USER_NAMESPACE_RE.exec(key)
  return m ? m[1]!.toLowerCase() : null
}

/** The job ids that could have written this key (UUID-shaped only — `jobs.id`
 *  is a uuid column, and one malformed value fails the whole `in` filter). */
function jobIdCandidates(key: string): string[] {
  return objectKeyJobIdCandidates(key).filter((c) => UUID_RE.test(c))
}

/** Each job id a key could carry (lower-cased), with the keys that carry it. */
function keysByJobIdCandidate(keys: readonly string[]): Map<string, string[]> {
  const keysByCandidate = new Map<string, string[]>()
  for (const key of new Set(keys)) {
    for (const candidate of jobIdCandidates(key)) {
      const id = candidate.toLowerCase()
      const bucket = keysByCandidate.get(id)
      if (bucket) bucket.push(key)
      else keysByCandidate.set(id, [key])
    }
  }
  return keysByCandidate
}

/**
 * For each key, the job whose key family it is in, with that job's user — or
 * nothing when no job wrote it. One chunked read of `jobs` by id across every
 * user (the question is "who made this object", so no single user filter
 * fits; `user_id` is selected and compared by the callers). Throws on error.
 */
export async function familyJobOwners(
  keys: readonly string[],
  client: LookupClient = supabase,
): Promise<Map<string, { jobId: string; userId: string | null }>> {
  const keysByCandidate = keysByJobIdCandidate(keys)
  const owners = new Map<string, { jobId: string; userId: string | null }>()
  const candidates = [...keysByCandidate.keys()]
  for (let i = 0; i < candidates.length; i += LOOKUP_CHUNK) {
    const chunk = candidates.slice(i, i + LOOKUP_CHUNK)
    const { data, error } = await client.from("jobs").select("id, user_id").in("id", chunk)
    if (error) throw new Error(`key ownership lookup failed: ${error.message}`)
    for (const row of (data ?? []) as Array<{ id: string; user_id: string | null }>) {
      for (const key of keysByCandidate.get(String(row.id).toLowerCase()) ?? []) {
        if (isOwnedObjectKey(row.id, key)) owners.set(key, { jobId: row.id, userId: row.user_id })
      }
    }
  }
  return owners
}

/**
 * The keys a library row ties to something other than the job(s) being
 * deleted for — the guard the admin app expunge runs before it deletes a
 * job's files, shared with the retention reapers (decided 2026-10-08).
 *
 * A key stays deletable only when every `assets` row that names it was filed
 * for an own job (`isOwnJob(key, row.job_id)`): the worker files each output
 * into its runner's library under that job. A row with no job — an upload, a
 * gallery save, or an output whose job was deleted from history (the FK is
 * ON DELETE SET NULL) — or with another job keeps the key: deleting would
 * break a library item, and an R2 delete cannot be undone. A key no row names
 * stays deletable. Any user's row counts; the question is "whose library
 * would lose this object".
 *
 * Throws when the lookup fails: this is the only proof that no other library
 * needs the object, so a caller that cannot ask must not delete.
 */
export async function keysHeldByOtherLibraryRows(
  keys: readonly string[],
  isOwnJob: (key: string, jobId: string) => boolean,
  client: LookupClient = supabase,
): Promise<Set<string>> {
  const unique = [...new Set(keys.filter((k) => !!k))]
  const held = new Set<string>()
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK)
    const read = await assetRowsNamingKeys(client, "id, r2_key, job_id", chunk)
    if ("error" in read) throw new Error(`key ownership lookup failed at assets: ${read.error.message}`)
    for (const row of read.rows as Array<{ r2_key: string | null; job_id: string | null }>) {
      if (row.r2_key && !(row.job_id && isOwnJob(row.r2_key, row.job_id))) held.add(row.r2_key)
    }
  }
  return held
}

/**
 * PostgREST's `max_rows` (supabase/config.toml, and the hosted default): no
 * read returns more rows than this, and a cut-off read does not say so.
 */
const MAX_ROWS = 1000

type AssetRead = { rows: Array<Record<string, unknown>> } | { error: { message: string; code?: string } }

/**
 * Every `assets` row naming one of `keys` (one chunk). A read that comes back
 * full may have been cut off at `max_rows`, and a claim cut off the page would
 * let a deleter remove an object another library still uses — so a full read
 * is read again a page at a time, keyed by id (`id > <last id>`, never an
 * offset, which a concurrent delete would shift past a row), until a short
 * page (LOW 5 of the 2026-10-15 review). `columns` must include `id`. Returns
 * the database's error rather than throwing, so a caller can tell a missing
 * column from a failed read.
 */
async function assetRowsNamingKeys(client: LookupClient, columns: string, keys: readonly string[]): Promise<AssetRead> {
  const first = await client.from("assets").select(columns).in("r2_key", keys as string[])
  if (first.error) return { error: first.error }
  const firstRows = (first.data ?? []) as unknown as Array<Record<string, unknown>>
  if (firstRows.length < MAX_ROWS) return { rows: firstRows }
  const rows: Array<Record<string, unknown>> = []
  let after: string | null = null
  for (;;) {
    const base = client.from("assets").select(columns).in("r2_key", keys as string[])
    const page = await (after === null ? base : base.gt("id", after)).order("id").limit(MAX_ROWS)
    if (page.error) return { error: page.error }
    const pageRows = (page.data ?? []) as unknown as Array<Record<string, unknown>>
    rows.push(...pageRows)
    if (pageRows.length < MAX_ROWS) return { rows }
    after = String(pageRows[pageRows.length - 1]!.id)
  }
}

// ---------------------------------------------------------------------------
// THE ALLOW PROOF (decided 2026-10-15). See the note at the top of this file.
// ---------------------------------------------------------------------------

const MAX_KEY_LENGTH = 1024
/** Never in a key the platform mints: controls, a backslash, a percent escape,
 *  a query or fragment marker. Any of them makes one object answer to two
 *  spellings, so a key holding one is judged as nobody's. */
const UNSAFE_KEY_CHAR = /[\u0000-\u001f\u007f\\%?#]/

/**
 * A key in the one spelling storage gives it: no leading or trailing slash,
 * no empty, `.` or `..` segment, none of `UNSAFE_KEY_CHAR`. A key that could
 * be read as another (a traversal, an escaped slash, a doubled slash) proves
 * nothing and is never sent to the database.
 */
export function isCanonicalObjectKey(key: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > MAX_KEY_LENGTH) return false
  if (UNSAFE_KEY_CHAR.test(key)) return false
  return key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

/** The `assets` columns that say how a row came to name its key. */
export interface AssetProvenance {
  /** Migration 528: written once, at insert, by the database; never changed. */
  readonly recorded_reference?: boolean | null
  readonly r2_key?: string | null
  readonly upload_source?: string | null
  readonly job_id?: string | null
  readonly size_bytes?: number | string | null
  readonly pipeline_id?: string | null
  readonly pipeline_entity_id?: string | null
  readonly relay_job_id?: string | null
}

/** The `upload_source` values a storing path writes (every other value — `api`,
 *  `generation`, `library`, none — has no storing path behind it). */
const STORING_SOURCES: ReadonlySet<string> = new Set([
  "manual_upload",
  "generated",
  "url_import",
  "social_download",
  "media_process",
  "job",
])
/** The key the upload paths that write `manual_upload` mint:
 *  `uploads/<image|video|audio|data>s/<uuid>.<ext>`. */
const UPLOAD_KEY_RE =
  /^uploads\/(?:image|video|audio|data)s\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9]+$/i
/** A job output in the worker's output folders: `<folder>/<jobId>[-<suffix>][.<ext>]`. */
const OUTPUT_KEY_RE =
  /^(?:images|videos|audios|audio)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[^/]*)?(?:\.[^./]*)?$/i

/** The twin's constants, for the guard test that holds migration 528's SQL to them. */
export const RECORDED_REFERENCE_SHAPES = {
  storingSources: [...STORING_SOURCES],
  uploadKey: UPLOAD_KEY_RE,
  outputKey: OUTPUT_KEY_RE,
} as const

/**
 * Migration 528's classification of a row at insert —
 * `public.asset_recorded_reference_by_shape`, which stamps
 * `assets.recorded_reference` on every new row and stamped every existing row
 * once. A row RECORDS a url someone named, rather than being the record a
 * storing path wrote when it stored the bytes, when:
 *   - it is a relayed output (the bytes are the far end's);
 *   - its source has no storing path behind it (`api`, `generation`,
 *     `library`, none);
 *   - it has neither a job nor a size: a library save, an attached image, any
 *     row whose writer stored nothing;
 *   - it is a `manual_upload` pointing at a pipeline (an entity's attached
 *     image), or naming a key no upload path mints;
 *   - it is a generation's row (`generated`) for a key outside its job's
 *     family (an output that repeated a url its input named), or — its job
 *     since deleted — a key that is not a job output in the worker's folders.
 * A row naming no key records nothing.
 *
 * Callers read the stored flag (`isRecordedReference`); this twin is used only
 * while a database lacks the column (staging runs dev code before main applies
 * 528), and it is held to the SQL by one golden table.
 */
export function recordedReferenceByShape(row: AssetProvenance): boolean {
  const key = row.r2_key
  if (!key) return false
  if (row.relay_job_id) return true
  const source = row.upload_source ?? ""
  if (!STORING_SOURCES.has(source)) return true
  const jobId = row.job_id ? String(row.job_id).toLowerCase() : null
  if (jobId === null && !(Number(row.size_bytes ?? 0) > 0)) return true
  if (source === "manual_upload") return !!(row.pipeline_entity_id || row.pipeline_id) || !UPLOAD_KEY_RE.test(key)
  if (source === "generated") return jobId !== null ? !isOwnedObjectKey(jobId, key) : !OUTPUT_KEY_RE.test(key)
  return false
}

/**
 * A row the server wrote to RECORD a url someone named, rather than one it
 * wrote when it stored the bytes. Such a row is a pointer: it is never proof
 * of whose the object is, and its size was never a charge.
 *
 * Read from `assets.recorded_reference` (migration 528), which the database
 * computed when the row was inserted and which nothing may change afterwards —
 * never from the columns that can (`pipeline_entity_id` and `pipeline_id` are
 * ON DELETE SET NULL, `job_id` too; an admin's promote/demote rewrites
 * `upload_source`). Only a row read from a database that lacks the column
 * falls back to `recordedReferenceByShape`.
 */
export function isRecordedReference(row: AssetProvenance): boolean {
  if (typeof row.recorded_reference === "boolean") return row.recorded_reference
  return recordedReferenceByShape(row)
}

const PROVENANCE_COLUMNS =
  "id, r2_key, user_id, job_id, upload_source, size_bytes, pipeline_id, pipeline_entity_id, relay_job_id"

/**
 * Whether the database has `assets.recorded_reference` (migration 528): asked
 * by reading it, remembered for a while (a running process outlives the
 * migration reaching its database).
 */
let flagColumn: { present: boolean; until: number } | null = null
const FLAG_COLUMN_RECHECK_MS = 10 * 60 * 1000

/** Test-only: forget what the last read learned about the column. */
export function _resetRecordedReferenceColumnForTests(): void {
  flagColumn = null
}

function isMissingFlagColumn(error: { message: string; code?: string }): boolean {
  return error.code === "42703" && /recorded_reference/.test(error.message)
}

interface ProvenanceRow extends AssetProvenance {
  readonly id: string
  /** The row's user, lower-cased. */
  readonly user: string
}

/** What the database says about a set of keys, read once for every judgment. */
interface Evidence {
  readonly makers: Map<string, { jobId: string; userId: string | null }>
  /** The near-end user of the relayed job whose far-end id is the key's stem. */
  readonly relayMakers: Map<string, string | null>
  readonly rows: Map<string, ProvenanceRow[]>
}

/** One chunk's rows with their flag — or, before 528, without it. Throws on error. */
async function provenanceChunk(chunk: readonly string[], client: LookupClient): Promise<Array<Record<string, unknown>>> {
  const now = Date.now()
  const askFlag = flagColumn === null || flagColumn.present || flagColumn.until <= now
  if (askFlag) {
    const read = await assetRowsNamingKeys(client, `${PROVENANCE_COLUMNS}, recorded_reference`, chunk)
    if (!("error" in read)) {
      flagColumn = { present: true, until: Number.POSITIVE_INFINITY }
      return read.rows
    }
    if (!isMissingFlagColumn(read.error)) {
      throw new Error(`key ownership lookup failed at assets: ${read.error.message}`)
    }
    flagColumn = { present: false, until: now + FLAG_COLUMN_RECHECK_MS }
  }
  const read = await assetRowsNamingKeys(client, PROVENANCE_COLUMNS, chunk)
  if ("error" in read) throw new Error(`key ownership lookup failed at assets: ${read.error.message}`)
  return read.rows
}

/** Every `assets` row naming each key, any user's, with its provenance. Throws on error. */
async function provenanceRows(keys: readonly string[], client: LookupClient): Promise<Map<string, ProvenanceRow[]>> {
  const rows = new Map<string, ProvenanceRow[]>()
  for (let i = 0; i < keys.length; i += LOOKUP_CHUNK) {
    const data = await provenanceChunk(keys.slice(i, i + LOOKUP_CHUNK), client)
    for (const row of data as unknown as Array<AssetProvenance & { id: unknown; r2_key: string | null; user_id: string | null }>) {
      if (!row.r2_key || !row.user_id) continue
      const entry: ProvenanceRow = { ...row, id: String(row.id), user: row.user_id.toLowerCase() }
      const list = rows.get(row.r2_key)
      if (list) list.push(entry)
      else rows.set(row.r2_key, [entry])
    }
  }
  return rows
}

/** For each key, the user of the relayed job whose far-end id is its stem. Throws on error. */
async function relayFamilyOwners(keys: readonly string[], client: LookupClient): Promise<Map<string, string | null>> {
  const keysByCandidate = keysByJobIdCandidate(keys)
  const owners = new Map<string, string | null>()
  const candidates = [...keysByCandidate.keys()]
  for (let i = 0; i < candidates.length; i += LOOKUP_CHUNK) {
    const chunk = candidates.slice(i, i + LOOKUP_CHUNK)
    const { data, error } = await client.from("jobs").select("relay_job_id, user_id").in("relay_job_id", chunk)
    if (error) throw new Error(`key ownership lookup failed at relayed jobs: ${error.message}`)
    for (const row of (data ?? []) as Array<{ relay_job_id: string | null; user_id: string | null }>) {
      if (!row.relay_job_id) continue
      for (const key of keysByCandidate.get(String(row.relay_job_id).toLowerCase()) ?? []) {
        if (isOwnedObjectKey(String(row.relay_job_id).toLowerCase(), key)) owners.set(key, row.user_id)
      }
    }
  }
  return owners
}

/** One read per table for every key (none for a key that is not canonical). */
async function loadEvidence(keys: readonly string[], client: LookupClient): Promise<Evidence> {
  const canonical = [...new Set(keys)].filter(isCanonicalObjectKey)
  if (canonical.length === 0) return { makers: new Map(), relayMakers: new Map(), rows: new Map() }
  const makers = await familyJobOwners(canonical, client)
  const rows = await provenanceRows(canonical, client)
  // Only an instance that relays can hold an object its relay target made.
  const relayMakers = relayPossible() ? await relayFamilyOwners(canonical, client) : new Map<string, string | null>()
  return { makers, relayMakers, rows }
}

/** One user's standing on one object. */
export interface KeyJudgment {
  /** The platform recorded this user as the object's maker (see the top note). */
  readonly owned: boolean
  /** Another user made it, it sits in their namespace, or their library holds it. */
  readonly claimedByOthers: boolean
}

const NOTHING_PROVEN: KeyJudgment = { owned: false, claimedByOthers: false }

function judge(owner: string, key: string, evidence: Evidence): KeyJudgment {
  const self = owner.toLowerCase()
  if (self === "" || !isCanonicalObjectKey(key)) return NOTHING_PROVEN
  const namespace = keyNamespaceOwner(key)
  const maker = evidence.makers.get(key)
  const makerUser = maker === undefined ? undefined : (maker.userId ?? "").toLowerCase()
  const relayUser = evidence.relayMakers.has(key) ? (evidence.relayMakers.get(key) ?? "").toLowerCase() : undefined
  const rows = evidence.rows.get(key) ?? []
  const madeByAnother =
    (namespace !== null && namespace !== self) ||
    (makerUser !== undefined && makerUser !== self) ||
    (relayUser !== undefined && relayUser !== self)
  const owned =
    !madeByAnother &&
    (namespace === self ||
      makerUser === self ||
      relayUser === self ||
      rows.some((row) => row.user === self && !isRecordedReference(row)))
  return { owned, claimedByOthers: madeByAnother || rows.some((row) => row.user !== self) }
}

/** May a deleter acting for the judged user remove the object? */
export function mayDeleteObject(judgment: KeyJudgment): boolean {
  return judgment.owned && !judgment.claimedByOthers
}

/**
 * Each entry judged for its own owner, in input order — a reaper batch spans
 * many users. One read per table for the whole batch. Throws on error.
 */
export async function judgeKeyEntries(
  entries: ReadonlyArray<{ owner: string; key: string }>,
  client: LookupClient = supabase,
): Promise<KeyJudgment[]> {
  if (entries.length === 0) return []
  const evidence = await loadEvidence(entries.map((e) => e.key), client)
  return entries.map(({ owner, key }) => judge(owner, key, evidence))
}

/** Every key judged for one user. Throws on error. */
export async function judgeKeys(
  userId: string,
  keys: readonly string[],
  client: LookupClient = supabase,
): Promise<Map<string, KeyJudgment>> {
  const unique = [...new Set(keys.filter((k) => !!k))]
  const verdicts = await judgeKeyEntries(unique.map((key) => ({ owner: userId, key })), client)
  return new Map(unique.map((key, i) => [key, verdicts[i] ?? NOTHING_PROVEN]))
}

/** The keys `userId` provably made — what a writer may record for them. Throws on error. */
export async function keysProvablyOwnedBy(
  userId: string,
  keys: readonly string[],
  client: LookupClient = supabase,
): Promise<Set<string>> {
  const verdicts = await judgeKeys(userId, keys, client)
  return new Set([...verdicts].filter(([, v]) => v.owned).map(([key]) => key))
}

/** The keys a deleter acting for `userId` may remove: theirs, and nobody else's. Throws on error. */
export async function keysUserMayDelete(
  userId: string,
  keys: readonly string[],
  client: LookupClient = supabase,
): Promise<Set<string>> {
  const verdicts = await judgeKeys(userId, keys, client)
  return new Set([...verdicts].filter(([, v]) => mayDeleteObject(v)).map(([key]) => key))
}

/**
 * `keys` minus every object the user cannot be shown to own alone, logging
 * what was kept. For the interactive deletes, which keep the objects (and
 * still remove their own row) when the lookup itself fails.
 */
export async function ownKeysOnly(userId: string, keys: readonly string[], where: string): Promise<string[]> {
  if (keys.length === 0) return []
  try {
    const deletable = await keysUserMayDelete(userId, keys)
    const kept = keys.length - keys.filter((k) => deletable.has(k)).length
    if (kept > 0) {
      console.warn(`[key-ownership] ${where}: kept ${kept} object(s) not provably this user's alone`)
    }
    return keys.filter((k) => deletable.has(k))
  } catch (err) {
    console.error(`[key-ownership] ${where}: ownership lookup failed, keeping ${keys.length} object(s):`, err)
    return []
  }
}

/** One library row about to be permanently deleted. */
export interface AssetRowRef extends AssetProvenance {
  readonly id: string
  readonly r2_key: string | null
}

export interface AssetDeleteJudgment {
  /** The user provably made the object the row names. */
  readonly owned: boolean
  /** Owned, and nobody else claims it: the object may go (subject to the referrer checks). */
  readonly deleteObject: boolean
  /** The row's size was charged to this user when the bytes were stored: refund it. */
  readonly refundable: boolean
}

/** A reaper's verdict on one row: the delete judgment, and whether another
 *  user's claim keeps the object (and a pointer to it) if this row lets go. */
export interface AssetReapJudgment extends AssetDeleteJudgment {
  readonly claimedByOthers: boolean
}

const NOTHING_TO_REAP: AssetReapJudgment = { owned: false, deleteObject: false, refundable: false, claimedByOthers: false }

/** One row's verdict from evidence already read. The row is judged as STORED
 *  (found by id among the rows naming its key), never as a caller described
 *  it; a row the database no longer holds refunds nothing. */
function judgeRow(owner: string, row: { id: string; r2_key: string | null }, evidence: Evidence): AssetReapJudgment {
  if (!row.r2_key) return NOTHING_TO_REAP
  const verdict = judge(owner, row.r2_key, evidence)
  const stored = (evidence.rows.get(row.r2_key) ?? []).find((r) => r.id === String(row.id))
  return {
    owned: verdict.owned,
    deleteObject: mayDeleteObject(verdict),
    refundable: verdict.owned && stored !== undefined && !isRecordedReference(stored),
    claimedByOthers: verdict.claimedByOthers,
  }
}

/**
 * The permanent delete's two questions about one `assets` row: may its object
 * go, and was its size a charge to this user? The refund needs both an owned
 * object and an ORIGIN row (not `isRecordedReference`): a recorded reference's
 * size is zero (a save) or whatever its caller sent (an attached image), and a
 * generation's row for a url its output repeated recorded bytes nobody stored
 * — never a charge. Throws on error.
 */
export async function judgeAssetRowDelete(
  userId: string,
  row: AssetRowRef,
  client: LookupClient = supabase,
): Promise<AssetDeleteJudgment> {
  if (!row.r2_key) return { owned: false, deleteObject: false, refundable: false }
  const evidence = await loadEvidence([row.r2_key], client)
  const { owned, deleteObject, refundable } = judgeRow(userId, row, evidence)
  return { owned, deleteObject, refundable }
}

/**
 * The same judgment for a reaper's batch of rows, each for its own user: one
 * read per table for the whole batch, the verdicts keyed by row id. Throws on
 * error.
 */
export async function judgeAssetRows(
  rows: ReadonlyArray<{ id: string; user_id: string; r2_key: string | null }>,
  client: LookupClient = supabase,
): Promise<Map<string, AssetReapJudgment>> {
  const keys = rows.flatMap((r) => (r.r2_key ? [r.r2_key] : []))
  const evidence =
    keys.length > 0 ? await loadEvidence(keys, client) : { makers: new Map(), relayMakers: new Map(), rows: new Map() }
  return new Map(rows.map((row) => [String(row.id), judgeRow(row.user_id, row, evidence)]))
}

// ---------------------------------------------------------------------------
// A url a caller names, before a row records it (decided 2026-10-15).
// ---------------------------------------------------------------------------

/** How a writer may record a url: as-is (not ours), as an object of the caller's, or not at all. */
export type RecordableUrl =
  | { readonly kind: "external" }
  | { readonly kind: "owned"; readonly key: string; readonly url: string }
  | { readonly kind: "refused" }

/**
 * The key an own-storage url names, read strictly: a url on the public host
 * (`R2_PUBLIC_URL`'s host, any scheme) or the fallback host, whose path is the
 * public path prefix followed by a CANONICAL key — no percent escape, no
 * doubled slash. The url parser has already resolved `.`/`..` segments and
 * dropped the query and fragment. A path of ours that is not exactly one key
 * is `unreadable`. With no public url configured, nothing is ours.
 */
function storageObjectKeyOf(url: string): { kind: "external" } | { kind: "ours"; key: string } | { kind: "unreadable" } {
  if (!config.R2_PUBLIC_URL) return { kind: "external" }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: "external" }
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { kind: "external" }
  const host = parsed.hostname.toLowerCase()
  let prefix: string | null = null
  const fallback = (config.R2_PUBLIC_FALLBACK_DOMAIN ?? "").trim().toLowerCase()
  if (fallback !== "" && host === fallback) prefix = "/"
  if (prefix === null) {
    try {
      const base = new URL(config.R2_PUBLIC_URL)
      if (host === base.hostname.toLowerCase()) {
        prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
      }
    } catch {
      /* a malformed config url names no host */
    }
  }
  if (prefix === null) return { kind: "external" }
  if (!parsed.pathname.startsWith(prefix)) return { kind: "unreadable" }
  const key = parsed.pathname.slice(prefix.length)
  return isCanonicalObjectKey(key) ? { kind: "ours", key } : { kind: "unreadable" }
}

/**
 * What a writer that records a url a caller names (a library save, a pipeline
 * entity's image) may do with it. A url off our storage is not ours to judge:
 * `external`, recorded as before. A url on our storage is `owned` — with the
 * one key it names and that key's canonical url, which the writer stores —
 * only when the caller provably made the object; otherwise `refused`, the same
 * answer whether the object exists or not, so the refusal tells nobody
 * anything about another user's files. Throws when the lookup fails.
 */
export async function judgeUrlForRecording(
  userId: string,
  url: string,
  client: LookupClient = supabase,
): Promise<RecordableUrl> {
  const where = storageObjectKeyOf(url)
  if (where.kind === "external") return { kind: "external" }
  if (where.kind === "unreadable") return { kind: "refused" }
  const verdict = (await judgeKeys(userId, [where.key], client)).get(where.key)
  if (!verdict?.owned) return { kind: "refused" }
  return { kind: "owned", key: where.key, url: `${config.R2_PUBLIC_URL}/${where.key}` }
}

// ---------------------------------------------------------------------------
// WHOSE OBJECT DOES THIS URL NAME? The reader's question (decided 2026-10-07).
//
// A deleter asks "would anyone else lose this object"; a reader about to
// DOWNLOAD a url or FORWARD it (to a provider, an ffmpeg input, a plugin) on
// a user's behalf asks "is this object someone else's". The evidence is the
// same three rules, read in the reader's order:
//   - who MADE it: the key's job family (`<jobId>[-<suffix>]`) or the upload
//     namespace. Another user made it: foreign. The user made it: theirs,
//     whoever else's library also holds it — another user saving the user's
//     output to their library must not take the output from its maker.
//   - with no maker known, who CLAIMED it FIRST: the earliest `assets` row
//     naming the key (review round, decided 2026-10-07). Any user can save
//     any url to their library, so "another user holds it" alone let a
//     stranger's later save take the owner's own upload from them. Another
//     user's row at least as early as every row of the user's is foreign (a
//     tie cannot be told apart).
//   - neither: nobody claims it, and it is not foreign (the deleters' rule).
// A url's `url` query parameters are judged too, on any host: our own public
// proxy routes (`/v1/download`, `/v1/image-proxy`) serve whatever object that
// parameter names (review round, decided 2026-10-07).
//
// A READER judges only urls on our storage hosts: what a url elsewhere holds
// is not ours to judge. A WRITER (`forWrite`) also asks what migration 482's
// trigger asks — the path of EVERY url, whatever its host, read the trigger's
// way (`storageUrlPathAnyHost`) — so a write it lets through is one the
// trigger accepts, and never fails half-way (a seed holding a reservation
// for a pipeline with no scenes).
// ---------------------------------------------------------------------------

/** Where a url points: not our storage, an object of ours, or ours but unreadable. */
export type StorageUrlPath =
  | { readonly kind: "external" }
  | { readonly kind: "ours"; readonly path: string }
  | { readonly kind: "unreadable" }

/**
 * The object key a url names on our storage: a url on the public host
 * (`R2_PUBLIC_URL`'s host, any scheme — the CDN redirects http) or on the
 * fallback host (`R2_PUBLIC_FALLBACK_DOMAIN`, which serves the same bucket and
 * which `r2KeyFromOurUrl` does not know). The path is percent-decoded (the
 * host decodes it too, so an encoded spelling names the same object) and
 * loses the public url's path prefix when it has it. A path of ours that
 * cannot be decoded, or that is empty, is "unreadable": it cannot be judged,
 * so a reader treats it as foreign.
 */
export function storageUrlPath(url: string): StorageUrlPath {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { kind: "external" }
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { kind: "external" }
  const host = parsed.hostname.toLowerCase()
  let prefix: string | null = null
  const fallback = (config.R2_PUBLIC_FALLBACK_DOMAIN ?? "").trim().toLowerCase()
  if (fallback !== "" && host === fallback) prefix = "/"
  if (prefix === null && config.R2_PUBLIC_URL) {
    try {
      const base = new URL(config.R2_PUBLIC_URL)
      if (host === base.hostname.toLowerCase()) {
        prefix = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`
      }
    } catch {
      /* a malformed config url names no host */
    }
  }
  if (prefix === null) return { kind: "external" }
  let path: string
  try {
    path = decodeURIComponent(parsed.pathname)
  } catch {
    return { kind: "unreadable" }
  }
  const rel = (path.startsWith(prefix) ? path.slice(prefix.length) : path).replace(/^\/+/, "")
  return rel ? { kind: "ours", path: rel } : { kind: "unreadable" }
}

/** The upload namespace's owner anywhere in a path (a bucket prefix may lead). */
const NAMESPACE_IN_PATH_RE =
  /(?:^|\/)uploads\/(?:handoff\/)?[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i

/** The path, and every tail of it that starts after a `/` and still holds one:
 *  the keys a library row could name it by (a bucket prefix is not part of
 *  the key). Mirrors migration 482. */
function keyTails(path: string): string[] {
  const parts = path.split("/")
  const tails = [path]
  for (let i = 1; i < parts.length - 1; i++) tails.push(parts.slice(i).join("/"))
  return tails
}

// --- Migration 482's url reading, ported (the write side's judge). ---------
// `scene-url-ownership.test.ts` and `scene-url-ownership.behavior.sql` assert
// one golden table against both, so they cannot drift apart.

/** `storage_url_normalize`: C0 controls and spaces trimmed at both ends,
 *  ASCII tab/newline/CR removed, `\` read as `/` (as a browser reads a url). */
function normalizeUrl(url: string): string {
  return url
    .replace(/^[\u0001- ]+|[\u0001- ]+$/g, "")
    .replace(/[\t\n\r]/g, "")
    .replace(/\\/g, "/")
}

/** `storage_url_ascii_decode`: ASCII percent-escapes decoded, others kept. */
function asciiDecode(s: string): string {
  return s.replace(/%([0-9A-Fa-f]{2})/g, (m, hex: string) => {
    const code = parseInt(hex, 16)
    return code >= 1 && code <= 127 ? String.fromCharCode(code) : m
  })
}

/** `storage_url_path`: the path of a url on ANY host, read as migration 482
 *  reads it — no scheme, host, query or fragment, ASCII-decoded, no leading
 *  slashes. Never throws; any string has a path. */
export function storageUrlPathAnyHost(url: string): string {
  const bare = normalizeUrl(url)
    .replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*/, "")
    .replace(/[?#][\s\S]*$/, "")
  return asciiDecode(bare).replace(/^\/+/, "")
}

/** `storage_url_query_urls`: every `url` query parameter, decoded as a query
 *  string is (`+` is a space; the key too, so `%75rl` is `url`), in order. */
export function storageUrlQueryUrls(url: string): string[] {
  const query = /^[^#?]*\?([^#]*)/.exec(normalizeUrl(url))?.[1] ?? ""
  const out: string[] = []
  for (const part of query.split("&")) {
    const eq = part.indexOf("=")
    const key = eq >= 0 ? part.slice(0, eq) : part
    if (asciiDecode(key.replace(/\+/g, " ")) !== "url") continue
    out.push(asciiDecode((eq >= 0 ? part.slice(eq + 1) : "").replace(/\+/g, " ")))
  }
  return out
}

/** The job id migration 482 reads from a path's last segment (case-blind, as
 *  the uuid cast is), or null. */
function triggerJobIdOf(path: string): string | null {
  const stem = path.replace(/^[\s\S]*\//, "").replace(/^([\s\S]+)\.[^.]*$/, "$1")
  const head = stem.slice(0, 36)
  if (!UUID_RE.test(head)) return null
  return stem.length === 36 || stem[36] === "-" ? head.toLowerCase() : null
}

/** One chunked read of `jobs` by id: each id's user. Throws on error. */
async function jobUsersById(ids: readonly string[], client: LookupClient): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)]
  const users = new Map<string, string | null>()
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK)
    const { data, error } = await client.from("jobs").select("id, user_id").in("id", chunk)
    if (error) throw new Error(`key ownership lookup failed: ${error.message}`)
    for (const row of (data ?? []) as Array<{ id: string; user_id: string | null }>) {
      users.set(String(row.id).toLowerCase(), row.user_id)
    }
  }
  return users
}

type LibraryClaim = { user: string; at: number | null }

/** A timestamptz as PostgREST prints it, to microseconds (Date.parse keeps
 *  only milliseconds, and two claims a microsecond apart are not a tie). */
function claimTime(value: unknown): number | null {
  if (typeof value !== "string") return null
  const m = /^(.*?:\d\d)(?:\.(\d+))?((?:[+-]\d\d(?::?\d\d)?)|Z)?$/i.exec(value.trim())
  if (!m) return null
  const zone = m[3] ?? "Z"
  const ms = Date.parse(`${m[1]!.replace(" ", "T")}${/^[+-]\d\d$/.test(zone) ? `${zone}:00` : zone}`)
  if (Number.isNaN(ms)) return null
  return ms * 1000 + Number(((m[2] ?? "") + "000000").slice(0, 6))
}

/** For each key, every `assets` row naming it: whose, and when. Throws on error. */
async function libraryClaims(keys: readonly string[], client: LookupClient): Promise<Map<string, LibraryClaim[]>> {
  const unique = [...new Set(keys.filter((k) => !!k))]
  const claims = new Map<string, LibraryClaim[]>()
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK)
    const { data, error } = await client.from("assets").select("r2_key, user_id, created_at").in("r2_key", chunk)
    if (error) throw new Error(`key ownership lookup failed at assets: ${error.message}`)
    for (const row of (data ?? []) as Array<{ r2_key: string | null; user_id: string | null; created_at?: unknown }>) {
      if (!row.r2_key || !row.user_id) continue
      const claim = { user: row.user_id.toLowerCase(), at: claimTime(row.created_at) }
      const list = claims.get(row.r2_key)
      if (list) list.push(claim)
      else claims.set(row.r2_key, [claim])
    }
  }
  return claims
}

/** Migration 482's claim rule: another user's claim at least as early as every
 *  claim of `self`'s makes the key foreign. A claim with no readable time is
 *  never "earlier" (fail closed). */
function claimedFirstByOther(claims: readonly LibraryClaim[], self: string): boolean {
  const own = claims.filter((c) => c.user === self)
  return claims.some(
    (other) =>
      other.user !== self &&
      !own.some((mine) => mine.at !== null && other.at !== null && mine.at < other.at),
  )
}

/** A path to judge, and which reading found it. */
type Judged = { url: string; path: string; rule: "reader" | "trigger" }

/**
 * The urls among `urls` that name an object another user made or (no maker
 * known) claimed first, for a reader acting for `ownerId` — plus every url of
 * ours that cannot be read. A reader judges only our storage hosts (an
 * external url is not ours to judge); with `forWrite`, every url is also
 * judged as migration 482's trigger judges it. A url's `url` query
 * parameters are judged with it. Throws when a lookup fails: a caller that
 * cannot ask must not forward or write.
 */
export async function foreignStorageUrls(
  ownerId: string,
  urls: readonly string[],
  client: LookupClient = supabase,
  opts: { forWrite?: boolean } = {},
): Promise<Set<string>> {
  const self = ownerId.toLowerCase()
  const foreign = new Set<string>()
  const judged: Judged[] = []
  const collect = (top: string, url: string): void => {
    const where = storageUrlPath(url)
    if (where.kind === "unreadable") foreign.add(top)
    else if (where.kind === "ours") judged.push({ url: top, path: where.path, rule: "reader" })
    if (opts.forWrite) {
      const path = storageUrlPathAnyHost(url)
      if (path !== "") judged.push({ url: top, path, rule: "trigger" })
    }
    // Each inner url is shorter than the one carrying it, so this ends.
    for (const inner of storageUrlQueryUrls(url)) collect(top, inner)
  }
  for (const url of new Set(urls)) collect(url, url)
  if (judged.length === 0) return foreign

  const readerPaths = judged.filter((j) => j.rule === "reader").map((j) => j.path)
  const makers = readerPaths.length > 0 ? await familyJobOwners(readerPaths, client) : new Map()
  const triggerJobs = judged.flatMap((j) => (j.rule === "trigger" ? [triggerJobIdOf(j.path)] : [])).filter(
    (id): id is string => id !== null,
  )
  const triggerMakers = triggerJobs.length > 0 ? await jobUsersById(triggerJobs, client) : new Map<string, string | null>()

  const unmade: Judged[] = []
  for (const j of judged) {
    if (foreign.has(j.url)) continue
    const namespace = NAMESPACE_IN_PATH_RE.exec(j.path)?.[1]?.toLowerCase() ?? null
    let makerUser: string | null | undefined
    if (j.rule === "reader") {
      const maker = makers.get(j.path)
      makerUser = maker === undefined ? undefined : maker.userId
    } else {
      const jobId = triggerJobIdOf(j.path)
      makerUser = jobId !== null && triggerMakers.has(jobId) ? triggerMakers.get(jobId) : undefined
    }
    if (namespace !== null && namespace !== self) foreign.add(j.url)
    else if (makerUser !== undefined && (makerUser ?? "").toLowerCase() !== self) foreign.add(j.url)
    else if (namespace === null && makerUser === undefined) unmade.push(j)
  }
  const pending = unmade.filter((j) => !foreign.has(j.url))
  if (pending.length === 0) return foreign

  const claims = await libraryClaims(pending.flatMap((j) => keyTails(j.path)), client)
  for (const j of pending) {
    const all = keyTails(j.path).flatMap((key) => claims.get(key) ?? [])
    if (claimedFirstByOther(all, self)) foreign.add(j.url)
  }
  return foreign
}
