/**
 * Collections — where a workflow's records live (decided 2026-10-05).
 *
 * A collection belongs to one person and holds records: a title, a text, a
 * link, the links of its pictures / videos / sounds, a small bag of extra
 * fields and where the record came from. Text and links only — never files;
 * a media link from a platform expires on its own schedule, so a consumer
 * that needs the picture later copies it (an upload node), the collection
 * keeps the link as given.
 *
 * Why public: `Collection` / `CollectionRecord` are what `/v1/collections`
 * returns and the SDK's `collections` resource types; the caps are what the
 * page and the API quote; the digest and the ingest map are the ONE rule the
 * read node, MCP and the CLI render records with.
 */

export const COLLECTION_NAME_MAX = 80
export const COLLECTION_DESCRIPTION_MAX = 500
export const COLLECTION_RECORD_TITLE_MAX = 500
export const COLLECTION_RECORD_TEXT_MAX = 20_000
export const COLLECTION_RECORD_URL_MAX = 2_000
export const COLLECTION_RECORD_MEDIA_MAX = 20
export const COLLECTION_RECORD_FIELDS_MAX = 50
export const COLLECTION_RECORD_FIELDS_BYTES_MAX = 16 * 1024
export const COLLECTION_DEDUPE_KEY_MAX = 300
export const COLLECTION_IDEMPOTENCY_KEY_MAX = 200
/** Records per page of `GET /v1/collections/:id/records`. */
export const COLLECTIONS_PAGE_MAX = 100
export const COLLECTIONS_PAGE_DEFAULT = 50
/** The longest a headline (a record's one-line name) gets. */
export const COLLECTION_HEADLINE_MAX = 120

export const COLLECTION_MEDIA_TYPES = ["image", "video", "audio", "link"] as const
export type CollectionMediaType = (typeof COLLECTION_MEDIA_TYPES)[number]

export interface CollectionMedia {
  readonly type: CollectionMediaType
  /** The file's link, as given (never fetched, never copied). */
  readonly url: string
  /** A video's poster frame, when known. */
  readonly posterUrl?: string
}

/** How many collections a person may have, and how many records each may hold. */
export interface CollectionCaps {
  readonly collections: number
  readonly records: number
}

/**
 * Caps by effective tier (decided 2026-10-05: open to free accounts; past the
 * records cap the OLDEST records are evicted, never the write refused — a
 * scheduled pipeline must not stall silently). `payg` is a derived tier whose
 * entitlements are basic's; `enterprise` reads as business.
 *
 * A tier this table does not know has NO caps here (`collectionCapsForTier`
 * answers undefined): the API then holds the account to no cap rather than to
 * free's, because the cap is enforced by DELETING records — a new tier or a
 * misspelt one must never cost a paying account its records. Add the tier.
 */
export const COLLECTION_TIER_CAPS: Readonly<Record<string, CollectionCaps>> = {
  free: { collections: 3, records: 500 },
  payg: { collections: 10, records: 5_000 },
  basic: { collections: 10, records: 5_000 },
  standard: { collections: 30, records: 20_000 },
  pro: { collections: 100, records: 100_000 },
  business: { collections: 300, records: 250_000 },
  enterprise: { collections: 300, records: 250_000 },
}

export function collectionCapsForTier(tier: string | null | undefined): CollectionCaps | undefined {
  return tier ? COLLECTION_TIER_CAPS[tier] : undefined
}

export interface Collection {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly recordCount: number
  readonly createdAt: string
  readonly updatedAt: string
}

/** Where a record came from — a node in a run, or a direct write. */
export interface CollectionRecordSource {
  readonly via?: "api" | "mcp" | "node" | "ui"
  readonly nodeType?: string
  readonly workflowId?: string
  readonly executionId?: string
  readonly nodeId?: string
}

export type CollectionFieldValue = string | number | boolean

export interface CollectionRecord {
  readonly id: string
  readonly collectionId: string
  readonly title: string
  readonly text: string
  readonly url: string | null
  readonly media: readonly CollectionMedia[]
  readonly fields: Readonly<Record<string, CollectionFieldValue>>
  /** The normalized key the collection deduplicates on (defaults to the link); null when the record has none. */
  readonly dedupeKey: string | null
  readonly source: CollectionRecordSource
  readonly createdAt: string
}

/** The caller's limits as the API quotes them: `null` is "no limit" (a
 *  self-hosted server with no ceiling configured, or a tier the caps table
 *  does not know). */
export interface CollectionLimits {
  readonly collections: number | null
  readonly records: number | null
}

/** The answer of `GET /v1/collections`. `available` is false on a server whose
 *  database does not have collections yet (the data is then empty). */
export interface ListCollectionsResult {
  readonly data: readonly Collection[]
  readonly available: boolean
  /** The caller's limits, so a client never carries its own copy of the tier table. */
  readonly caps: CollectionLimits
}

export type CreateCollectionInput = {
  readonly name: string
  readonly description?: string
}

export type UpdateCollectionInput = {
  readonly name?: string
  readonly description?: string
}

/** Query of `GET /v1/collections/:id/records`. */
export type ListCollectionRecordsParams = {
  /** Words to find in the title, the text or the link. */
  readonly q?: string
  /** Only records saved at or after this ISO timestamp (date and time). */
  readonly since?: string
  /** The `nextCursor` of the previous page. */
  readonly cursor?: string
  /** 1–100, default 50. */
  readonly limit?: number
}

export interface ListCollectionRecordsResult {
  readonly data: readonly CollectionRecord[]
  readonly nextCursor: string | null
}

/** The body of `POST /v1/collections/:id/records`. An explicit field wins over
 *  what `item` (any JSON — a feed post, a search result, an LLM's object) maps to. */
export type AddCollectionRecordInput = {
  readonly title?: string
  readonly text?: string
  readonly url?: string
  readonly media?: readonly CollectionMedia[]
  readonly fields?: Readonly<Record<string, CollectionFieldValue>>
  readonly dedupeKey?: string
  readonly source?: CollectionRecordSource
  readonly item?: unknown
}

export type CollectionWriteOutcome = "inserted" | "duplicate" | "replayed"

export interface AddCollectionRecordResult {
  readonly record: CollectionRecord
  readonly outcome: CollectionWriteOutcome
  /** Records evicted past the collection's cap by this write. */
  readonly evicted: number
}

export type CollectionExportFormat = "csv" | "json"
export type CollectionDigestFormat = "headlines" | "full"
export const COLLECTION_DIGEST_SEPARATOR = "\n\n---\n\n"

/** The Read Collection node: how far back it may look (720 hours = 30 days; `days` × 24 is held to the same ceiling) and how many records one run emits. */
export const COLLECTION_READ_WINDOW_HOURS_MAX = 720
export const COLLECTION_READ_LIMIT_MAX = 200
export type CollectionReadWindowUnit = "hours" | "days"
export type CollectionReadOrder = "newest" | "oldest"

/** The start of a Read Collection window, as an ISO timestamp — `amount` × `unit` back from `now`, held to the ceiling. */
export function collectionReadSince(amount: number, unit: CollectionReadWindowUnit, now = Date.now()): string {
  const hours = Math.min(COLLECTION_READ_WINDOW_HOURS_MAX, Math.max(1, Math.floor(Number.isFinite(amount) ? amount : 24)) * (unit === "days" ? 24 : 1))
  return new Date(now - hours * 3_600_000).toISOString()
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim().length > 0 ? v : undefined)
const isScalar = (v: unknown): v is CollectionFieldValue =>
  typeof v === "string" || (typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean"

/** A link a record may hold: `http(s)`, no whitespace, at most 2,000 characters. */
export function isCollectionUrl(v: unknown): v is string {
  return typeof v === "string" && /^https?:\/\/\S+$/i.test(v) && v.length <= COLLECTION_RECORD_URL_MAX
}
const isHttpUrl = isCollectionUrl

/**
 * The first `max` characters of a text, counted as Postgres counts them
 * (`char_length`: code points), so a cut never splits a surrogate pair into a
 * lone half the database refuses.
 */
export function clampChars(text: string, max: number): string {
  if (text.length <= max) return text
  const points = Array.from(text)
  return points.length <= max ? text : points.slice(0, max).join("")
}

/**
 * The key a collection deduplicates on: trimmed, inner whitespace collapsed,
 * lower-cased, at most 300 characters; null when there is nothing to key on.
 */
export function normalizeDedupeKey(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) raw = String(raw)
  if (typeof raw !== "string") return null
  const compact = raw.trim().replace(/\s+/g, " ")
  // A link keeps its path's case: a short link or a video id is case-sensitive
  // (bit.ly/AbC and bit.ly/abc are two pages). Only its scheme and host are
  // case-insensitive, and the URL parser folds exactly those.
  const key = clampChars(looksLikeLink(compact) ? canonicalUrl(compact) : compact.toLowerCase(), COLLECTION_DEDUPE_KEY_MAX).trim()
  return key.length > 0 ? key : null
}

// A boolean wrapper: the type guard would narrow the string to `never` in the else branch.
const looksLikeLink = (s: string): boolean => isCollectionUrl(s)

/**
 * How many records one write may evict past the cap. A cap that drops at once
 * (a lapsed subscription, billing briefly reading "free") then trims a big
 * collection a little per write instead of deleting most of it in one go.
 */
export const COLLECTION_EVICT_MAX_PER_WRITE = 100

function canonicalUrl(url: string): string {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

export function isCollectionMedia(v: unknown): v is CollectionMedia {
  return (
    isRecord(v) &&
    (COLLECTION_MEDIA_TYPES as readonly string[]).includes(v.type as string) &&
    isHttpUrl(v.url) &&
    (v.posterUrl === undefined || v.posterUrl === null || isHttpUrl(v.posterUrl))
  )
}

/** The media list as stored: known kinds with http(s) links, no repeats, at most 20. */
export function normalizeCollectionMedia(value: unknown): CollectionMedia[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: CollectionMedia[] = []
  for (const item of value) {
    if (out.length >= COLLECTION_RECORD_MEDIA_MAX) break
    if (!isCollectionMedia(item) || seen.has(item.url)) continue
    seen.add(item.url)
    out.push({ type: item.type, url: item.url, ...(item.posterUrl ? { posterUrl: item.posterUrl } : {}) })
  }
  return out
}

/** The extra fields as stored: scalar values only, at most 50 keys and 16 KB. */
export function normalizeCollectionFields(value: unknown): Record<string, CollectionFieldValue> {
  if (!isRecord(value)) return {}
  const out: Record<string, CollectionFieldValue> = {}
  let bytes = 2
  let count = 0
  for (const [key, v] of Object.entries(value)) {
    if (count >= COLLECTION_RECORD_FIELDS_MAX) break
    if (!isScalar(v) || key.length === 0 || key.length > 100) continue
    const entry = JSON.stringify(key) + ":" + JSON.stringify(v) + ","
    if (bytes + entry.length > COLLECTION_RECORD_FIELDS_BYTES_MAX) break
    out[key] = v
    bytes += entry.length
    count += 1
  }
  return out
}

/**
 * A record's one-line name: its title, else the first line of its text, else
 * its link. Tolerates a partial record (a hand-written node result in workflow
 * JSON): a missing field reads as empty rather than throwing on the canvas.
 */
export function collectionRecordHeadline(record: Partial<Pick<CollectionRecord, "title" | "text" | "url">>): string {
  const title = (typeof record.title === "string" ? record.title : "").trim()
  if (title) return clampChars(title, COLLECTION_HEADLINE_MAX)
  const line = (typeof record.text === "string" ? record.text : "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (line) return line.length > COLLECTION_HEADLINE_MAX ? `${clampChars(line, COLLECTION_HEADLINE_MAX - 1)}…` : line
  return typeof record.url === "string" ? record.url : ""
}

/**
 * ONE digest for a collection's records — what the Read Collection node's
 * `text` handle, MCP `read_collection` and the CLI print. `headlines`: one line
 * per record (headline · date · link); `full`: the whole text of each record
 * under its headline, separated by a rule.
 */
export function collectionRecordsDigest(
  records: ReadonlyArray<Partial<Pick<CollectionRecord, "title" | "text" | "url" | "createdAt">> | null | undefined>,
  format: CollectionDigestFormat = "headlines",
): string {
  // Tolerates a partial or null record (a hand-written node result in
  // workflow JSON): the engines rebuild this digest from saved data.
  const rows = records.filter((r): r is Partial<Pick<CollectionRecord, "title" | "text" | "url" | "createdAt">> => typeof r === "object" && r !== null)
  const str = (v: unknown): string => (typeof v === "string" ? v : "")
  if (format === "full") {
    return rows
      .map((r) => {
        const head = collectionRecordHeadline(r)
        const body = str(r.text).trim()
        const lines = [head ? `### ${head}` : "", body && body !== head ? body : "", str(r.url)].filter((l) => l.length > 0)
        return lines.join("\n")
      })
      .filter((block) => block.length > 0)
      .join(COLLECTION_DIGEST_SEPARATOR)
  }
  return rows
    .map((r) => {
      const parts = [collectionRecordHeadline(r)]
      const created = str(r.createdAt)
      if (created) parts.push(created.slice(0, 10))
      const url = str(r.url)
      if (url && url !== parts[0]) parts.push(url)
      return `- ${parts.filter((p) => p.length > 0).join(" · ")}`
    })
    .join("\n")
}

/** What `ingestRecordFromJson` reads out of an item: the record's fields, before explicit overrides. */
export interface IngestedRecord {
  readonly title: string
  readonly text: string
  readonly url: string | null
  readonly media: CollectionMedia[]
  readonly fields: Record<string, CollectionFieldValue>
  readonly dedupeKey: string | null
}

const TITLE_KEYS = ["title", "headline", "name", "subject"] as const
const TEXT_KEYS = ["text", "body", "caption", "description", "content", "summary", "dek"] as const
const URL_KEYS = ["url", "postUrl", "link", "href", "permalink"] as const
/**
 * Keys a record is told apart by when it has no link. `id` comes last and only
 * as a non-numeric string: an LLM writing `{ "id": 1, … }` per article, or a
 * scraper's ordinal, numbers each RUN's items from 1 — a key that would mark
 * every later run's first item a duplicate of the first run's.
 */
const DEDUPE_KEYS = ["slug", "postId", "externalId", "id"] as const
const isDedupeValue = (key: string, v: unknown): boolean =>
  key === "id"
    ? typeof v === "string" && v.trim().length > 0 && !/^\d+$/.test(v.trim())
    : (typeof v === "string" && v.trim().length > 0) || (typeof v === "number" && Number.isFinite(v))
const IMAGE_KEYS = ["imageUrl", "thumbnailUrl", "image", "thumbnail"] as const
const VIDEO_KEYS = ["videoUrl", "video"] as const
const AUDIO_KEYS = ["audioUrl", "audio"] as const
const MEDIA_SHAPED_KEYS = new Set<string>(["media", ...IMAGE_KEYS, ...VIDEO_KEYS, ...AUDIO_KEYS])

function firstString(item: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = str(item[key])
    if (v !== undefined) return v
  }
  return undefined
}

/** The first link key whose value IS a link (`{ url: "t.me/x", postUrl: "https://t.me/x" }` reads the second). */
function firstUrl(item: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const v = item[key]
    if (typeof v === "string" && isHttpUrl(v.trim())) return v.trim()
  }
  return null
}

/** Every medium an item carries, in page order, each link once, at most 20 — one pass, whatever the item's size. */
function mediaFromItem(item: Record<string, unknown>): CollectionMedia[] {
  const seen = new Set<string>()
  const out: CollectionMedia[] = []
  const push = (m: CollectionMedia): boolean => {
    if (out.length >= COLLECTION_RECORD_MEDIA_MAX) return false
    if (!seen.has(m.url)) {
      seen.add(m.url)
      out.push(m)
    }
    return true
  }
  if (Array.isArray(item.media)) {
    for (const entry of item.media) {
      if (out.length >= COLLECTION_RECORD_MEDIA_MAX) break
      if (!isRecord(entry)) continue
      const type = entry.type === "photo" ? "image" : entry.type
      const poster = isHttpUrl(entry.posterUrl) ? entry.posterUrl : undefined
      if (type === "video" && !isHttpUrl(entry.url) && poster) {
        // A video the platform embeds nowhere: its poster is all there is to keep.
        push({ type: "image", url: poster })
        continue
      }
      if (isCollectionMedia({ ...entry, type })) push({ type: type as CollectionMediaType, url: entry.url as string, ...(poster ? { posterUrl: poster } : {}) })
    }
  } else if (isRecord(item.media)) {
    // A Social Search post: `media: { kind, thumbnailUrl, videoUrl }`.
    const m = item.media
    if (isHttpUrl(m.videoUrl)) push({ type: "video", url: m.videoUrl, ...(isHttpUrl(m.thumbnailUrl) ? { posterUrl: m.thumbnailUrl } : {}) })
    else if (isHttpUrl(m.thumbnailUrl)) push({ type: "image", url: m.thumbnailUrl })
  }
  for (const key of IMAGE_KEYS) if (isHttpUrl(item[key]) && !push({ type: "image", url: item[key] as string })) break
  for (const key of VIDEO_KEYS) if (isHttpUrl(item[key]) && !push({ type: "video", url: item[key] as string })) break
  for (const key of AUDIO_KEYS) if (isHttpUrl(item[key]) && !push({ type: "audio", url: item[key] as string })) break
  return out
}

/**
 * A record read out of any JSON item — a Telegram post, a Social Search
 * result, an LLM's object, a plain string. Title ← title / headline / name;
 * text ← text / body / caption / description; link ← the first of url /
 * postUrl / link that IS an http(s) link; media ← `media[]` and the image /
 * video / audio link keys; the dedupe key ← the link, else slug / id / postId;
 * every other scalar lands in `fields` (a nested object's `name`, such as a
 * forwarded-from, lands as that name). One pass over the item: its size is
 * the caller's body limit, never a loop of its own.
 */
export function ingestRecordFromJson(item: unknown): IngestedRecord {
  if (!isRecord(item)) {
    const text = typeof item === "string" ? item : item === undefined || item === null ? "" : JSON.stringify(item)
    return { title: "", text: clampChars(text, COLLECTION_RECORD_TEXT_MAX), url: null, media: [], fields: {}, dedupeKey: null }
  }
  const title = clampChars((firstString(item, TITLE_KEYS) ?? "").trim(), COLLECTION_RECORD_TITLE_MAX)
  const text = clampChars(firstString(item, TEXT_KEYS) ?? "", COLLECTION_RECORD_TEXT_MAX)
  const url = firstUrl(item, URL_KEYS)
  const media = mediaFromItem(item)
  const taken = new Set<string>([...TITLE_KEYS, ...TEXT_KEYS, ...URL_KEYS, ...MEDIA_SHAPED_KEYS])
  const fields: Record<string, unknown> = {}
  let kept = 0
  for (const [key, v] of Object.entries(item)) {
    if (kept >= COLLECTION_RECORD_FIELDS_MAX) break
    if (taken.has(key)) continue
    if (isScalar(v)) fields[key] = v
    else if (isRecord(v) && typeof v.name === "string" && v.name.trim()) fields[key] = v.name
    else continue
    kept += 1
  }
  const dedupeSource = url ?? DEDUPE_KEYS.filter((k) => isDedupeValue(k, item[k])).map((k) => item[k])[0]
  return {
    title,
    text,
    url,
    media,
    fields: normalizeCollectionFields(fields),
    dedupeKey: normalizeDedupeKey(dedupeSource),
  }
}
