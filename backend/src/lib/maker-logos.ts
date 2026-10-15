import { createHash } from "node:crypto"
import type { ModelMakerId } from "@nodaro/shared/model-catalog"
import { config } from "./config.js"
import { getAppSettings, settingsReadFailed } from "./app-settings.js"
import { headR2Object, isStorageConfigured, r2Url } from "./storage.js"
import { MAKER_LOGO_PREFIX, makerLogoObjectKey } from "./maker-logo-keys.js"

export { MAKER_LOGO_PREFIX, makerLogoObjectKey }

/** How long a storage answer stands (the route's own HTTP cache is 5 minutes too). */
const VERIFIED_TTL_MS = 5 * 60_000
/** A check that failed — an outage or a timeout, not a 404 — is asked again sooner. */
const FAILED_TTL_MS = 60_000
/** Each check's bound: a public read must not wait on a slow store. */
const HEAD_TIMEOUT_MS = 2_500
/** The settings read's bound on this path (the reader caches for a minute; a cold read can be slow). */
const SETTINGS_WAIT_MS = 1_500
/** The only type a mark is published as. */
const MARK_CONTENT_TYPE = "image/svg+xml"

export type MakerLogoUrls = ReadonlyMap<ModelMakerId, string>

/** What the last check of a maker's file found — its address, or null — and until when it stands. */
interface MakerCheck {
  url: string | null
  until: number
}

type Probe = { kind: "answered"; url: string | null } | { kind: "failed" }

const checks = new Map<ModelMakerId, MakerCheck>()
const inflight = new Map<ModelMakerId, { epoch: number; promise: Promise<void> }>()
/** Bumped by a reset: a check started before it writes nothing. */
let epoch = 0
/** The last declaration this process read, served while a read is slow or fails. */
let lastDeclared: readonly ModelMakerId[] = []

/**
 * The address of every maker mark this deployment publishes, by maker id —
 * what `GET /v1/models` serves as a model's `logoUrl` (null for a maker
 * missing here).
 *
 * A maker is here only when BOTH hold:
 *  - the operator declared it (`app_settings.model_maker_logos`), and
 *  - storage holds its file as an SVG — asked with a HEAD against the bucket,
 *    never a GET through the CDN.
 * The second is the invariant, not a convenience: the CDN keeps a 404 at its
 * edge for a year (backend/CLAUDE.md, "Never GET a CDN media URL before its
 * job is complete"), and the bundled stack's Caddy does the same under
 * `/storage/*`, so a client that fetched an address before its file landed
 * would break that address there for a year. Declaring before uploading is
 * therefore safe — the address appears once the file does — and a file
 * removed later withdraws its address at the next check. The files sit under a
 * kept prefix (`kept-storage-prefixes.ts`): no delete in the app removes one.
 *
 * The address carries the file's version (`?v=`, from its ETag and
 * LastModified): a replaced mark, and even the same bytes uploaded again,
 * reach clients under a new address, which no cached 404 can shadow.
 *
 * Never waits on storage once something is known: each maker's answer stands
 * five minutes, and an expired one is served while it is checked again in the
 * background — only a declaration with nothing checked yet waits, bounded by
 * one HEAD. A failed check (not a 404) keeps that maker's last verified
 * address and is asked again after a minute, without shortening any other
 * maker's. The settings read is bounded too, and the function never rejects:
 * the model catalog must not go down with it.
 */
export async function makerLogoUrls(): Promise<MakerLogoUrls> {
  const declared = await readDeclared()
  if (declared.length === 0 || !config.R2_PUBLIC_URL || !isStorageConfigured()) return new Map()
  const now = Date.now()
  const due = declared.filter((id) => (checks.get(id)?.until ?? 0) <= now)
  const running = due.map(checkMaker)
  if (running.length > 0 && !declared.some((id) => checks.has(id))) await Promise.all(running)
  const urls = new Map<ModelMakerId, string>()
  for (const id of declared) {
    const url = checks.get(id)?.url
    if (url) urls.set(id, url)
  }
  return urls
}

/** The declared makers, read with a bound; a slow or failed read keeps the last declaration read. */
async function readDeclared(): Promise<readonly ModelMakerId[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const settings = await Promise.race([
      getAppSettings(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), SETTINGS_WAIT_MS)
      }),
    ])
    // `?? []`: a settings object from before the field existed reads as none.
    if (settings && !settingsReadFailed(settings)) lastDeclared = settings.model_maker_logos ?? []
  } catch (err) {
    console.warn("[maker-logos] could not read the declared marks; serving the last declaration read:", err instanceof Error ? err.message : err)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  return lastDeclared
}

/** Check one maker's file — once at a time per maker; callers that arrive meanwhile share the check. */
function checkMaker(id: ModelMakerId): Promise<void> {
  const running = inflight.get(id)
  if (running) return running.promise
  const entry = { epoch, promise: Promise.resolve() }
  entry.promise = probe(id)
    .then((found) => {
      // Only the check this maker is waiting on, started since the last reset, may write.
      if (inflight.get(id) !== entry || entry.epoch !== epoch) return
      const now = Date.now()
      checks.set(
        id,
        found.kind === "failed"
          ? { url: checks.get(id)?.url ?? null, until: now + FAILED_TTL_MS }
          : { url: found.url, until: now + VERIFIED_TTL_MS },
      )
    })
    .finally(() => {
      if (inflight.get(id) === entry) inflight.delete(id)
    })
  inflight.set(id, entry)
  return entry.promise
}

/** HEAD one maker's file: its address when it is there as an SVG, null when it is not, `failed` when storage did not answer. */
async function probe(id: ModelMakerId): Promise<Probe> {
  const objectKey = makerLogoObjectKey(id)
  try {
    const head = await headR2Object(objectKey, { abortSignal: AbortSignal.timeout(HEAD_TIMEOUT_MS) })
    if (!head.exists) return { kind: "answered", url: null }
    const type = (head.contentType ?? "").split(";")[0]!.trim().toLowerCase()
    if (type !== MARK_CONTENT_TYPE) {
      console.warn(
        `[maker-logos] ${objectKey} is stored as "${head.contentType ?? "no type"}", not ${MARK_CONTENT_TYPE}; ` +
          "not published — upload it again with that Content-Type",
      )
      return { kind: "answered", url: null }
    }
    return { kind: "answered", url: versionedUrl(r2Url(objectKey), head) }
  } catch (err) {
    console.warn(
      `[maker-logos] could not check ${objectKey} (${err instanceof Error ? err.message : String(err)}); ` +
        "keeping its last verified address until the next check",
    )
    return { kind: "failed" }
  }
}

/** The address with its file's version: a replaced file, or the same bytes uploaded again, gets a new address. */
function versionedUrl(url: string, head: { etag?: string; lastModified?: Date }): string {
  const etag = (head.etag ?? "").replace(/[^0-9a-z]/gi, "").toLowerCase()
  const modified = head.lastModified ? String(head.lastModified.getTime()) : ""
  if (!etag && !modified) return url
  const version = createHash("sha256").update(`${etag}|${modified}`).digest("hex").slice(0, 16)
  return `${url}?v=${version}`
}

/** Test hook: forget every check and declaration; a check still running writes nothing. */
export function __resetMakerLogoCacheForTests(): void {
  epoch++
  checks.clear()
  inflight.clear()
  lastDeclared = []
}

/** Test hook: wait for the checks running in the background. */
export async function __settleMakerLogoChecksForTests(): Promise<void> {
  await Promise.all([...inflight.values()].map((entry) => entry.promise))
}
