import { config } from "./config.js"
import { supabase } from "./supabase.js"
import { isOwnedObjectKey, objectKeyJobIdCandidates } from "./job-policy-outputs.js"

/** The client the lookups read with: the backend's service role, or a test's stand-in. */
type LookupClient = Pick<typeof supabase, "from">

/**
 * WHOSE OBJECT IS THIS? The question every storage deleter asks before it
 * deletes a key on a user's behalf (decided 2026-10-06).
 *
 * A deleter finds its keys in rows: an `assets` row, a location's url
 * columns, a job's output, a run's node states. Rows say where a file is; they
 * do not say whose it is. Before migration 480 a browser could insert an
 * `assets` row or write a location naming any key, and several API paths
 * still store a url the caller names (a gallery save, a pasted reference).
 * So a reaper or a permanent delete that trusted the row deleted whatever the
 * row named — another user's file included.
 *
 * Keys are not namespaced by user, so this answers from what the object
 * itself says about its maker:
 *   - its key family (`<prefix>/<jobId>` or `<prefix>/<jobId>-<suffix>`,
 *     `isOwnedObjectKey`): the job that wrote it, and that job's user. Jobs
 *     are server-written since migration 474, and a job id cannot be reused,
 *     so this is the strongest proof there is.
 *   - the per-user upload namespace (`uploads/<kind>/<userId>/...`, and its
 *     `uploads/handoff/...` form) the MCP upload tools write.
 *   - another user's library row (review round, decided 2026-10-07). Most keys
 *     carry no maker in their name — `POST /v1/upload` writes
 *     `uploads/<kind>s/<uuid>.<ext>`, and scraped media, split images and
 *     copied keys sit outside any job family — but the upload wrote an
 *     `assets` row for its user. An `assets` row of anyone other than the
 *     deleter's user that names the key is a claim: deleting the object would
 *     break that user's library item. This is the same content-addressed
 *     check `permanentlyDeleteAsset` runs, made central so every deleter
 *     (both reapers, the soft-deleted sweep, the entity permanent deletes)
 *     asks it.
 *
 * A key any of these says belongs to someone else is "claimed by another
 * user", and no deleter acting for this user may delete it. A key none of
 * them names (an orphan no library holds) is not claimed by anyone and stays
 * deletable — keeping it would leak storage on every ordinary delete.
 *
 * ERROR POLICY: a failed lookup THROWS. This is a deny-proof, not a marker: a
 * caller that cannot ask must not delete. Reapers count the error and stop the
 * batch; interactive deletes keep the object and still remove the row.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The MCP upload tools' per-user key namespace (lib/mcp/tools/upload.ts). */
const USER_NAMESPACE_RE =
  /^uploads\/(?:handoff\/)?[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//i

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
  const keysByCandidate = new Map<string, string[]>()
  for (const key of new Set(keys)) {
    for (const candidate of jobIdCandidates(key)) {
      const id = candidate.toLowerCase()
      const bucket = keysByCandidate.get(id)
      if (bucket) bucket.push(key)
      else keysByCandidate.set(id, [key])
    }
  }
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
 * For each key, every user whose `assets` row names it. One chunked read of
 * `assets` by `r2_key` across every user (the question is "whose library
 * would lose this object"). Throws on error.
 */
export async function libraryHolders(
  keys: readonly string[],
  client: LookupClient = supabase,
): Promise<Map<string, Set<string>>> {
  const unique = [...new Set(keys.filter((k) => !!k))]
  const holders = new Map<string, Set<string>>()
  for (let i = 0; i < unique.length; i += LOOKUP_CHUNK) {
    const chunk = unique.slice(i, i + LOOKUP_CHUNK)
    const { data, error } = await client.from("assets").select("r2_key, user_id").in("r2_key", chunk)
    if (error) throw new Error(`key ownership lookup failed at assets: ${error.message}`)
    for (const row of (data ?? []) as Array<{ r2_key: string | null; user_id: string | null }>) {
      if (!row.r2_key || !row.user_id) continue
      const users = holders.get(row.r2_key)
      if (users) users.add(row.user_id.toLowerCase())
      else holders.set(row.r2_key, new Set([row.user_id.toLowerCase()]))
    }
  }
  return holders
}

/**
 * Each entry's verdict, in input order: `true` when the object at `key` is
 * claimed by someone other than `owner` (the user the deleter acts for).
 * Entries may name different owners — a reaper batch spans many users.
 */
export async function claimedByOthers(
  entries: ReadonlyArray<{ owner: string; key: string }>,
): Promise<boolean[]> {
  if (entries.length === 0) return []
  const keys = entries.map((e) => e.key)
  const makers = await familyJobOwners(keys)
  const holders = await libraryHolders(keys)
  return entries.map(({ owner, key }) => {
    const self = owner.toLowerCase()
    const namespace = keyNamespaceOwner(key)
    if (namespace !== null && namespace !== self) return true
    const maker = makers.get(key)
    if (maker !== undefined && (maker.userId ?? "").toLowerCase() !== self) return true
    return [...(holders.get(key) ?? [])].some((user) => user !== self)
  })
}

/** The keys another user has a claim on, for a deleter acting for `userId`. */
export async function keysClaimedByOthers(userId: string, keys: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(keys.filter((k) => !!k))]
  const verdicts = await claimedByOthers(unique.map((key) => ({ owner: userId, key })))
  return new Set(unique.filter((_, i) => verdicts[i]))
}

/**
 * `keys` minus those another user has a claim on, logging what was kept. For
 * the interactive deletes, which keep the object (and still remove their own
 * row) when the lookup itself fails.
 */
export async function ownKeysOnly(userId: string, keys: readonly string[], where: string): Promise<string[]> {
  if (keys.length === 0) return []
  try {
    const foreign = await keysClaimedByOthers(userId, keys)
    if (foreign.size > 0) {
      console.warn(`[key-ownership] ${where}: kept ${foreign.size} object(s) another user made or owns`)
    }
    return keys.filter((k) => !foreign.has(k))
  } catch (err) {
    console.error(`[key-ownership] ${where}: ownership lookup failed, keeping ${keys.length} object(s):`, err)
    return []
  }
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
