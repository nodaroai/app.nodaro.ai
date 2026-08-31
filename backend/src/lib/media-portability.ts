import { randomUUID } from "node:crypto"
import type {
  WorkflowAssetKind,
  WorkflowExport,
  WorkflowImportReport,
  WorkflowImportSkippedAsset,
  WorkflowMediaRef,
} from "@nodaro/shared"
import { EXECUTION_DATA_KEYS } from "@nodaro/shared"
import { safeFetch } from "./safe-fetch.js"

/**
 * Workflow media portability (#866).
 *
 * "Workflows are portable JSON" held in one direction only: a bundle exported
 * from a private host (localhost, a LAN box, a `.internal` name) carries media
 * URLs nobody else can fetch, and import accepted it silently — the breakage
 * surfaced at Run time as an opaque provider error. Two halves here:
 *
 *   - export: `findUnroutableMedia` lists the URLs another instance cannot
 *     reach, so the exporter is told before sharing the file;
 *   - import: `rehostForeignMedia` copies publicly reachable media that is
 *     not already on THIS instance's storage into it, so the workflow runs
 *     from local copies instead of someone else's host.
 *
 * URL fields are found by NAME (`…url` / `…urls` / `…urllist`), the same rule
 * the cloud proxy's re-host walk uses — a prompt that happens to contain a
 * link is never touched. The import half narrows that further: endpoint-like
 * names and generated/preview fields are never fetched or rewritten.
 *
 * The import half must NEVER throw: one flaky media URL is a skipped entry in
 * the report, not a lost import.
 */

/** Field names whose values are media URLs. */
export const URL_FIELD = /url$|urls$|urllist$/i

/** Node data nests (scene-graph `assets[].url`), but not without end. */
const WALK_DEPTH = 6

const HTTP_URL = /^https?:\/\//i
const MEDIA_TYPE = /^(image|video|audio)\//i

/**
 * URL-named fields that point at ENDPOINTS, not files — a webhook target, a
 * platform post, a share page, a presigned upload slot. Re-hosting those would
 * mean GETting a third party's endpoint from this server and, if it happened
 * to answer with a media type, rewriting the link to our copy.
 */
const ENDPOINT_FIELD = /(webhook|callback|endpoint|api|redirect|page|post|share|feed|site|link|upload)url(s|list)?$/i

/** Derived media — regenerable, and the importer should not pay to copy it. */
const DERIVED_FIELD = /(thumbnail|preview|poster)url(s|list)?$/i

/**
 * A host nothing outside this machine/network can reach. Shared with the
 * nodaro.ai client's "can the cloud fetch this?" check — one list.
 */
export function isUnroutableHost(hostname: string): boolean {
  // Strip IPv6 brackets so ::1 / fc00:: literals compare cleanly.
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return (
    host === "localhost" ||
    host === "host.docker.internal" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    /^127\./.test(host) || // whole loopback /8, not just .0.1
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) || // link-local — cloud metadata lives here
    /^0\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || // CGNAT 100.64/10
    host === "::1" ||
    host === "::" ||
    /^f[cd][0-9a-f]{2}:/.test(host) || // IPv6 unique-local fc00::/7
    /^fe80:/.test(host) // IPv6 link-local
  )
}

/** True when another instance (or the cloud) could not fetch this URL. */
export function isUnroutableMediaUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== "http:" && u.protocol !== "https:") return true
    return isUnroutableHost(u.hostname)
  } catch {
    return true
  }
}

type NodeLike = { readonly id?: unknown; readonly data?: unknown }

interface WalkFilter {
  /** Skip a top-level `data` key entirely (runtime/result state on import). */
  readonly skipTopLevel?: (key: string) => boolean
  /** Skip a URL-named field by its own name (endpoints, previews). */
  readonly skipField?: (key: string) => boolean
}

/** The import half's filter: inputs only — never outputs, never endpoints. */
const REHOST_FILTER: WalkFilter = {
  skipTopLevel: (key) => EXECUTION_DATA_KEYS.has(key),
  skipField: (key) => ENDPOINT_FIELD.test(key) || DERIVED_FIELD.test(key),
}

function labelOf(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined
  const label = (data as { label?: unknown }).label
  return typeof label === "string" && label.trim() ? label : undefined
}

function walkUrlFields(
  value: unknown,
  path: string,
  depth: number,
  visit: (field: string, url: string) => void,
  filter: WalkFilter,
): void {
  if (depth > WALK_DEPTH || !value || typeof value !== "object") return
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkUrlFields(item, `${path}[${i}]`, depth + 1, visit, filter))
    return
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (depth === 0 && filter.skipTopLevel?.(key)) continue
    const field = path ? `${path}.${key}` : key
    if (URL_FIELD.test(key)) {
      if (filter.skipField?.(key)) continue
      if (typeof v === "string" && HTTP_URL.test(v)) visit(field, v)
      else if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === "string" && HTTP_URL.test(item)) visit(`${field}[${i}]`, item)
        })
      }
      continue
    }
    walkUrlFields(v, field, depth + 1, visit, filter)
  }
}

/** Every http(s) media URL referenced from the nodes' data, with its location. */
export function collectNodeMediaUrls(nodes: readonly unknown[], filter: WalkFilter = {}): WorkflowMediaRef[] {
  const out: WorkflowMediaRef[] = []
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue
    const node = n as NodeLike
    const nodeId = typeof node.id === "string" ? node.id : ""
    const nodeLabel = labelOf(node.data)
    walkUrlFields(
      node.data,
      "",
      0,
      (field, url) => {
        out.push(nodeLabel ? { nodeId, nodeLabel, field, url } : { nodeId, field, url })
      },
      filter,
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// The bundle's ENTITY assets (#1088)
//
// `WorkflowExport.assets` carries the characters / objects / creatures /
// locations behind the graph, and every one of them is a bag of media URLs
// (`sourceImageUrl`, each variant bucket's `{ name, url }`, a location's
// `referencePhotos`). Those URLs were as invisible to this module as the chips
// that reference them were to `collectAssetIds` — an export said the bundle was
// portable while its entity images sat on a host nobody else can reach, and an
// import re-created rows pointing at the EXPORTER's bytes.
// ---------------------------------------------------------------------------

/** The `assets` half of a bundle. */
export type BundleAssets = NonNullable<WorkflowExport["assets"]>

/** Bundle arm → the entity kind it holds. The one place the two names meet. */
const ASSET_ARMS = [
  ["characters", "character"],
  ["objects", "object"],
  ["creatures", "creature"],
  ["locations", "location"],
] as const

/** A media URL inside the bundle's `assets`, tagged with the entity it belongs to. */
export interface AssetMediaRef extends WorkflowMediaRef {
  readonly kind: WorkflowAssetKind
  /** The entity's id IN THE BUNDLE (the exporter's row id). */
  readonly assetId: string
}

/** Drop the asset-only tags — the wire shape is a plain {@link WorkflowMediaRef}. */
function plainRef(ref: WorkflowMediaRef): WorkflowMediaRef {
  const { nodeId, nodeLabel, field, url } = ref
  return nodeLabel ? { nodeId, nodeLabel, field, url } : { nodeId, field, url }
}

/**
 * Every http(s) media URL the bundle's entities reference. `nodeId` is empty —
 * these live beside the graph, not in it — and `nodeLabel` carries the entity's
 * name so a report reads as "Kira", not as a path.
 */
export function collectAssetMediaUrls(assets: BundleAssets | undefined): AssetMediaRef[] {
  if (!assets) return []
  const out: AssetMediaRef[] = []
  for (const [arm, kind] of ASSET_ARMS) {
    const entities = assets[arm] ?? []
    entities.forEach((entity, index) => {
      const name = typeof entity.name === "string" ? entity.name : ""
      walkUrlFields(
        entity,
        `assets.${arm}[${index}]`,
        0,
        (field, url) => {
          out.push(
            name
              ? { nodeId: "", nodeLabel: name, field, url, kind, assetId: entity.id }
              : { nodeId: "", field, url, kind, assetId: entity.id },
          )
        },
        {},
      )
    })
  }
  return out
}

/** The export half: media URLs another instance cannot fetch — the graph's and the bundled entities'. */
export function findUnroutableMedia(
  nodes: readonly unknown[],
  assets?: BundleAssets,
): WorkflowMediaRef[] {
  return [...collectNodeMediaUrls(nodes), ...collectAssetMediaUrls(assets).map(plainRef)].filter(
    (ref) => isUnroutableMediaUrl(ref.url),
  )
}

// ---------------------------------------------------------------------------
// Import half — copy foreign, reachable media into this instance's storage
// ---------------------------------------------------------------------------

export interface RehostOptions {
  /** Distinct URLs copied per import; the rest are reported as skipped. */
  readonly maxFiles?: number
  /** Per-file cap for video/audio (images use the image-import cap). */
  readonly maxBytes?: number
  readonly concurrency?: number
  readonly timeoutMs?: number
  /**
   * The bundle's entity assets (#1088). Their media is copied into the
   * importer's own storage — unconditionally, not only when it is foreign —
   * and the returned bundle points at the copies, so the rows created from it
   * own their bytes. An entity whose copy hit the storage quota is DROPPED
   * from the returned bundle and listed in `report.assetsSkipped`: the
   * production lands, that entity does not.
   */
  readonly assets?: BundleAssets
  /**
   * The bundle's freeform `settings` blob. REWRITE-ONLY: its URL fields follow
   * the copies made for the graph and the entities, but a URL that appears
   * ONLY here is never a copy candidate — settings is app-owned, unbounded,
   * and pulling it into the fetch pass would put an app's private shape in
   * charge of the importer's quota and the per-import cap.
   */
  readonly settings?: Record<string, unknown>
}

/** The copy limits alone — what {@link rehostOne} needs, without the payload. */
type RehostLimits = Required<Omit<RehostOptions, "assets" | "settings">>

// Buffered in memory while copying: maxBytes × concurrency is the peak.
const REHOST_DEFAULTS: RehostLimits = {
  maxFiles: 25,
  maxBytes: 50 * 1024 * 1024,
  concurrency: 2,
  timeoutMs: 20_000,
}

// The import half's storage/DB dependencies load lazily: the URL predicate
// and the walk are imported by the nodaro.ai client and the cloud proxy,
// whose suites mock config minimally — a static storage/supabase/sharp
// import here would make every one of them construct a real client at load.
const importDeps = () =>
  Promise.all([
    import("./storage.js"),
    import("./supabase.js"),
    import("./media-import.js"),
    import("../utils/file-validation.js"),
  ] as const)
type ImportDeps = Awaited<ReturnType<typeof importDeps>>

const EXT_BY_MIME: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
}

function extensionFor(mime: string, url: string): string {
  const known = EXT_BY_MIME[mime]
  if (known) return known
  try {
    const ext = new URL(url).pathname.split(".").pop() ?? ""
    if (/^[a-z0-9]{1,5}$/i.test(ext)) return ext.toLowerCase()
  } catch {
    /* fall through */
  }
  return "bin"
}

function filenameFor(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split("/").pop()
    return last ? decodeURIComponent(last) : undefined
  } catch {
    return undefined
  }
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

type FetchOutcome =
  | { readonly ok: true; readonly url: string }
  /** `quota` marks the one failure the caller treats differently: the
   *  importer's storage is full, so nothing else will fit either. */
  | { readonly ok: false; readonly reason: string; readonly quota?: boolean }

/**
 * Copy one foreign media URL into our storage. Images go through the same
 * decode-gated path as `POST /v1/import-image` (thumbnail + asset row);
 * video/audio are stored as-is with an asset row so the library and the
 * cleanup sweeps see them like any upload. Never throws — every failure is
 * a reason in the report.
 */
async function rehostOne(
  ref: WorkflowMediaRef,
  userId: string,
  opts: RehostLimits,
  deps: ImportDeps,
): Promise<FetchOutcome> {
  try {
    return await rehostOneUnsafe(ref, userId, opts, deps)
  } catch (err) {
    return { ok: false, reason: `copy failed: ${errorText(err)}` }
  }
}

async function rehostOneUnsafe(
  ref: WorkflowMediaRef,
  userId: string,
  opts: RehostLimits,
  deps: ImportDeps,
): Promise<FetchOutcome> {
  const [
    { uploadBufferToR2 },
    { supabase },
    { IMPORT_MAX_BYTES, readBodyCapped, storeImportedImageBuffer },
    { refundStorage, reserveStorageIfWithinLimit },
  ] = deps
  let res: Response
  try {
    res = await safeFetch(ref.url, { timeoutMs: opts.timeoutMs })
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${errorText(err)}` }
  }
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
  const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase()
  if (!MEDIA_TYPE.test(mime)) return { ok: false, reason: `not media (${mime || "no content-type"})` }
  const isImage = mime.startsWith("image/")
  const cap = isImage ? IMPORT_MAX_BYTES : opts.maxBytes
  let body: Buffer | null
  try {
    body = await readBodyCapped(res, cap)
  } catch (err) {
    // A reset or the timeout firing mid-body — the stream rejects.
    return { ok: false, reason: `download failed: ${errorText(err)}` }
  }
  if (body === null) return { ok: false, reason: `larger than ${Math.round(cap / (1024 * 1024))}MB` }

  if (isImage) {
    const stored = await storeImportedImageBuffer({
      userId,
      body,
      uploadSource: "url_import",
      sourceUrl: ref.url,
      filename: filenameFor(ref.url),
    })
    if (stored.ok) return { ok: true, url: stored.url }
    // 413 = `storage_limit_exceeded` — the quota case, not a bad file.
    return stored.status === 413
      ? { ok: false, reason: stored.message, quota: true }
      : { ok: false, reason: stored.message }
  }

  // Atomic storage reservation — the same race-free RPC the upload route uses.
  if (!(await reserveStorageIfWithinLimit(userId, body.length))) {
    return { ok: false, reason: "storage limit exceeded", quota: true }
  }
  const kind = mime.startsWith("video/") ? "video" : "audio"
  const fileId = randomUUID()
  const ext = extensionFor(mime, ref.url)
  const r2Key = `uploads/${kind}s/${fileId}.${ext}`
  let publicUrl: string
  try {
    // The reservation already counted the bytes — no trackUserId.
    publicUrl = await uploadBufferToR2(body, r2Key, mime)
  } catch (err) {
    await refundStorage(userId, body.length)
    return { ok: false, reason: `upload failed: ${errorText(err)}` }
  }
  // Asset record, best-effort like the upload route: the media is already in
  // place and referenced from the workflow, so a missing library row must not
  // fail the import — but it IS a permanent quota leak (reserved bytes with no
  // row to reclaim them through), so it is logged the way the upload route
  // logs it: loud, with everything needed to repair by hand.
  const { error } = await supabase.from("assets").insert({
    user_id: userId,
    type: kind,
    filename: filenameFor(ref.url) ?? `imported-${fileId}.${ext}`,
    mime_type: mime,
    size_bytes: body.length,
    r2_key: r2Key,
    r2_url: publicUrl,
    upload_source: "url_import",
    metadata: { source_url: ref.url },
  })
  if (error) {
    console.error(
      `[media-portability] ASSET ROW FAILED after upload — storage reserved with no row to reclaim it: user=${userId} key=${r2Key} bytes=${body.length}:`,
      error.message,
    )
  }
  return { ok: true, url: publicUrl }
}

async function runPool<T>(items: readonly T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!
      await work(item)
    }
  })
  await Promise.all(lanes)
}

/**
 * Deep copy of a node's DATA with every URL-field value passed through `map` —
 * inputs untouched. `maxDepth` defaults to the node-data budget; the settings
 * blob passes its own (see {@link SETTINGS_WALK_DEPTH}).
 */
function rewriteUrlFields(
  value: unknown,
  depth: number,
  map: (url: string) => string,
  maxDepth: number = WALK_DEPTH,
): unknown {
  if (depth > maxDepth || !value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((item) => rewriteUrlFields(item, depth + 1, map, maxDepth))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, v]) => {
      if (URL_FIELD.test(key)) {
        if (typeof v === "string") return [key, map(v)]
        if (Array.isArray(v)) return [key, v.map((item) => (typeof item === "string" ? map(item) : item))]
        return [key, v]
      }
      return [key, rewriteUrlFields(v, depth + 1, map, maxDepth)]
    }),
  )
}

/**
 * The settings blob's rewrite budget. `settings` sits two levels ABOVE a node's
 * `data`: an app namespaces itself (`settings.studio`) and indexes its own
 * entries (`…​.shots[]`) before it reaches the shapes node data starts at, so
 * the same `references[].url` that is depth 4 in a node is depth 7 here. Two
 * levels of headroom over {@link WALK_DEPTH}, for exactly that reason.
 */
const SETTINGS_WALK_DEPTH = WALK_DEPTH + 2

function emptyReport(): WorkflowImportReport {
  return { rehosted: 0, unreachable: [], skipped: [] }
}

/**
 * True when the importer has an `assets` ROW for the object behind one of our
 * own URLs — their own production, exported and read back in. Only then is
 * sharing the object safe: their delete, their reaper, their lifecycle.
 *
 * The row, not the key prefix, is the ownership proof — so this answers false
 * for an object the platform wrote WITHOUT recording a row (a few internal
 * paths do), and that URL is copied and charged again on a self-reimport. That
 * is the deliberate direction to be wrong in: copying is the safe default, and
 * every doubt (not our prefix, a DB error, no asset row) answers false. Never
 * throws.
 */
async function importerOwnsBytes(url: string, userId: string, deps: ImportDeps): Promise<boolean> {
  const [{ r2KeyFromOurUrl }, { supabase }] = deps
  const key = r2KeyFromOurUrl(url)
  if (!key) return false
  try {
    const { data, error } = await supabase
      .from("assets")
      .select("id")
      .eq("r2_key", key)
      .eq("user_id", userId)
      .limit(1)
    return !error && Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

/** Key for the skipped-entity map: an id is only unique within its kind. */
const entityKey = (kind: WorkflowAssetKind, id: string): string => `${kind}:${id}`

/**
 * The bundle's `assets` with every URL passed through `map` and every entity in
 * `skipped` dropped. Inputs untouched.
 */
function rewriteBundleAssets(
  assets: BundleAssets,
  map: (url: string) => string,
  skipped: ReadonlyMap<string, WorkflowImportSkippedAsset>,
): BundleAssets {
  const out = { ...assets } as Record<string, unknown>
  for (const [arm, kind] of ASSET_ARMS) {
    const entities = assets[arm]
    if (!entities) continue
    out[arm] = entities
      .filter((entity) => !skipped.has(entityKey(kind, entity.id)))
      .map((entity) => rewriteUrlFields(entity, 0, map))
  }
  return out as BundleAssets
}

/**
 * The import half. Returns new node objects (the input is never mutated), the
 * bundle's entity assets rewritten to the copies when `options.assets` was
 * given, the `settings` blob rewritten to the same copies when
 * `options.settings` was given, plus a report the response carries so the
 * importer can explain what happened. Never throws: an unavailable storage
 * layer degrades to "nothing copied, every candidate reported as skipped".
 */
export async function rehostForeignMedia<T>(
  nodes: readonly T[],
  userId: string,
  options: RehostOptions = {},
): Promise<{
  nodes: T[]
  assets?: BundleAssets
  settings?: Record<string, unknown>
  report: WorkflowImportReport
}> {
  const opts = { ...REHOST_DEFAULTS, ...options }
  const report = emptyReport()
  const bundleAssets = options.assets
  const bundleSettings = options.settings
  const refs = collectNodeMediaUrls(nodes, REHOST_FILTER)
  const assetRefs = collectAssetMediaUrls(bundleAssets)
  const unchanged = () => ({
    nodes: [...nodes],
    ...(bundleAssets ? { assets: bundleAssets } : {}),
    ...(bundleSettings ? { settings: bundleSettings } : {}),
    report,
  })
  if (refs.length === 0 && assetRefs.length === 0) return unchanged()

  let deps: ImportDeps
  try {
    // Loaded once per import, not once per file.
    deps = await importDeps()
  } catch (err) {
    const reason = `re-host unavailable: ${errorText(err)}`
    for (const ref of [...refs, ...assetRefs.map(plainRef)]) report.skipped.push({ ...ref, reason })
    return unchanged()
  }
  const { r2KeyFromOurUrl, getR2ObjectSize } = deps[0]

  // One decision per distinct URL, however many fields reference it. The two
  // halves keep SEPARATE candidate sets so the per-import cap can be applied to
  // each: one shared queue let a handful of well-populated entities (a
  // character's expressions + poses + lighting passes are ~20 URLs on their
  // own) consume every slot and starve the graph's media — the #866 breakage —
  // or, the other way round, a media-heavy graph leave the entities pointing at
  // the exporter's host, which is #1088's.
  const assetCandidates = new Map<string, WorkflowMediaRef>()
  const graphCandidates = new Map<string, WorkflowMediaRef>()
  const ownPrefixed = new Map<string, WorkflowMediaRef>()

  // ── Entity assets first (#1088) ──────────────────────────────────────────
  // Their rule is stricter than the graph's — copy even what already sits on
  // this instance — and classifying them first means a URL the graph ALSO
  // references follows it: one fetch, one charge, and the node field is
  // rewritten to the same copy. (Ordering decides which SET a shared URL joins,
  // not which one survives the cap — each set is capped on its own.)
  const assetOwners = new Map<string, AssetMediaRef[]>()
  for (const ref of assetRefs) {
    const owners = assetOwners.get(ref.url)
    if (owners) owners.push(ref)
    else assetOwners.set(ref.url, [ref])
  }
  const maybeAlreadyOurs: AssetMediaRef[] = []
  for (const owners of assetOwners.values()) {
    const ref = owners[0]!
    // Our own prefix FIRST, exactly as the graph's pass orders it below: a
    // self-hosted instance serves `http://localhost:3000/storage/…`, which
    // reads as unroutable to everyone but us — and we are the ones fetching.
    if (r2KeyFromOurUrl(ref.url)) {
      maybeAlreadyOurs.push(ref)
      continue
    }
    if (isUnroutableMediaUrl(ref.url)) {
      report.unreachable.push(plainRef(ref))
      continue
    }
    assetCandidates.set(ref.url, plainRef(ref))
  }
  await runPool(maybeAlreadyOurs, opts.concurrency, async (ref) => {
    if (await importerOwnsBytes(ref.url, userId, deps)) return
    // Not the importer's bytes. Copy them — unless the object is not here at
    // all, in which case our prefix is a coincidence (two default self-hosts
    // share it verbatim) and there is nothing to fetch.
    const size = await getR2ObjectSize(r2KeyFromOurUrl(ref.url)!).catch(() => 0)
    if (size <= 0) {
      report.unreachable.push(plainRef(ref))
      return
    }
    assetCandidates.set(ref.url, plainRef(ref))
  })

  // ── The graph's own media (#866) ─────────────────────────────────────────
  for (const ref of refs) {
    // Already decided as an entity's URL above — that decision governs.
    if (graphCandidates.has(ref.url) || ownPrefixed.has(ref.url) || assetOwners.has(ref.url)) continue
    if (r2KeyFromOurUrl(ref.url)) {
      ownPrefixed.set(ref.url, ref)
      continue
    }
    if (isUnroutableMediaUrl(ref.url)) {
      report.unreachable.push(ref)
      continue
    }
    graphCandidates.set(ref.url, ref)
  }

  // A URL under OUR public prefix is ours only if the object exists here. Two
  // default self-hosts share `http://localhost:3000/storage/…` verbatim, so a
  // bundle from install A looks "already ours" on install B by prefix alone —
  // the exact case this module exists for. Missing here ⇒ it is someone else's
  // private host, and nothing can fetch it.
  await runPool([...ownPrefixed.entries()], opts.concurrency, async ([url, ref]) => {
    const key = r2KeyFromOurUrl(url)!
    const size = await getR2ObjectSize(key).catch(() => 0)
    if (size <= 0) report.unreachable.push(ref)
  })

  // The cap is PER HALF, not per import: neither the bundle's entities nor the
  // graph's media can spend the other's slots. Each half keeps the wall-time
  // and memory bound it had when it was the only one (peak is still
  // `maxBytes × concurrency` — the two halves share one pool).
  const assetQueue = [...assetCandidates.values()]
  const graphQueue = [...graphCandidates.values()]
  for (const ref of [...assetQueue.splice(opts.maxFiles), ...graphQueue.splice(opts.maxFiles)]) {
    report.skipped.push({ ...ref, reason: `over the ${opts.maxFiles}-file import cap` })
  }
  const queue = [...assetQueue, ...graphQueue]

  const replacements = new Map<string, string>()
  const skippedAssets = new Map<string, WorkflowImportSkippedAsset>()
  await runPool(queue, opts.concurrency, async (ref) => {
    const outcome = await rehostOne(ref, userId, opts, deps)
    if (outcome.ok) {
      replacements.set(ref.url, outcome.url)
      report.rehosted += 1
      return
    }
    report.skipped.push({ ...ref, reason: outcome.reason })
    // Out of storage: the entity cannot own its images, so it is not created
    // at all. The production still lands — that is what the importer asked
    // for — and the entity is named in the report.
    if (!outcome.quota) return
    for (const owner of assetOwners.get(ref.url) ?? []) {
      skippedAssets.set(entityKey(owner.kind, owner.assetId), {
        kind: owner.kind,
        id: owner.assetId,
        name: owner.nodeLabel ?? "",
        reason: outcome.reason,
      })
    }
  })
  if (skippedAssets.size > 0) report.assetsSkipped = [...skippedAssets.values()]

  if (replacements.size === 0 && skippedAssets.size === 0) return unchanged()
  const map = (url: string) => replacements.get(url) ?? url
  const mapped =
    replacements.size === 0
      ? [...nodes]
      : nodes.map((n) => {
          if (!n || typeof n !== "object") return n
          const node = n as NodeLike
          // Same axis as the walk: depth 0 is `node.data`, and only INPUT
          // fields were fetched — but the rewrite may touch every field, since
          // it only ever substitutes URLs that were actually copied.
          return { ...(n as object), data: rewriteUrlFields(node.data, 0, map) } as T
        })
  return {
    nodes: mapped,
    ...(bundleAssets ? { assets: rewriteBundleAssets(bundleAssets, map, skippedAssets) } : {}),
    // The settings blob follows the SAME substitutions — nothing more. A
    // production that keeps a second view of its shots there (studio's
    // `settings.studio`) must not end up with one half on the importer's copies
    // and the other still on the exporter's bytes.
    ...(bundleSettings
      ? {
          settings:
            replacements.size === 0
              ? bundleSettings
              : (rewriteUrlFields(bundleSettings, 0, map, SETTINGS_WALK_DEPTH) as Record<
                  string,
                  unknown
                >),
        }
      : {}),
    report,
  }
}
