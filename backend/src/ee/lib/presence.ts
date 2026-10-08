import type { FastifyRequest } from "fastify"
import { clientAddress, clientCountry } from "../../lib/client-address.js"
import { deriveJobSource, type JobSource } from "../../lib/job-source.js"

/**
 * Who is signed in right now, and where — for the admin's "Signed in now"
 * list. Every signed-in request notes its user and surface (the app, the
 * studio, the extension, an MCP client, the CLI…, as `deriveJobSource` names
 * the caller for jobs) with the client's address, country and browser. A note
 * lives in the store for PRESENCE_TTL_MS and nowhere else: no database row,
 * no log.
 *
 * "Signed in now" means "has Nodaro open": an open tab keeps polling (credits,
 * the editor), so an idle tab counts too. The list says so.
 */
export const PRESENCE_TTL_MS = 15 * 60_000
/** What the list calls "now". */
export const PRESENCE_WINDOW_MS = 5 * 60_000
/** One note per user and surface per this long: a page polling every few seconds costs one store write. */
export const PRESENCE_WRITE_EVERY_MS = 30_000

export type PresenceSource = Exclude<JobSource, "internal">

export interface PresenceEntry {
  readonly userId: string
  readonly source: PresenceSource
  /** The specific surface within `source`: a host, an app id, an MCP client, a client version. */
  readonly detail: string | null
  readonly address: string | null
  /** ISO 3166 two letters, from Cloudflare; null when it does not say. */
  readonly country: string | null
  readonly userAgent: string | null
  /** Epoch milliseconds. */
  readonly lastSeenAt: number
}

export interface PresenceStore {
  put(entry: PresenceEntry): Promise<void>
  /** The notes seen since `since` (epoch ms), newest first. */
  since(since: number): Promise<PresenceEntry[]>
}

const USER_AGENT_MAX = 200

/** One user's surface: their latest note there replaces the last. */
export const surfaceKey = (entry: Pick<PresenceEntry, "source" | "detail">): string => `${entry.source}|${entry.detail ?? ""}`

/** A host as browsers send it: letters, digits, dots and dashes, maybe a port. */
const HOST = /^[a-z0-9.-]{1,80}(:\d{1,5})?$/

/**
 * The calling surface. `deriveJobSource` names it from the `Origin` header,
 * which browsers leave out of a same-origin GET — most of what the main app
 * sends (`/v1` is same-origin behind the bundled Caddy), so it would read as
 * "api". A browser marks every request `Sec-Fetch-Site`; a same-origin one is
 * the site at `Host`.
 */
function surfaceOf(req: FastifyRequest): { source: JobSource; detail: string | null } {
  const { source, sourceDetail } = deriveJobSource(req)
  if (source === "api" && req.headers["sec-fetch-site"] === "same-origin") {
    const host = typeof req.headers.host === "string" ? req.headers.host.toLowerCase() : ""
    if (HOST.test(host)) return { source: "web", detail: host }
  }
  return { source, detail: sourceDetail }
}

/** What one request says about who is here, or null when it is not a person's own visit. */
export function presenceOf(req: FastifyRequest, now: number): PresenceEntry | null {
  const userId = req.userId
  if (!userId) return null
  const { source, detail } = surfaceOf(req)
  // The orchestrator's own hop carries the workflow owner's id: a run is not its owner being here.
  if (source === "internal") return null
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"].slice(0, USER_AGENT_MAX) : null
  return { userId, source, detail, address: clientAddress(req), country: clientCountry(req), userAgent, lastSeenAt: now }
}

export interface PresenceRecorderOptions {
  readonly now?: () => number
  readonly writeEveryMs?: number
  /** How many (user, surface) pairs this process remembers writing — the least recent are forgotten first. */
  readonly maxTracked?: number
  readonly log?: (message: string) => void
}

/**
 * The `onResponse` hook's body: notes the request's user and surface, at most
 * once per `writeEveryMs`, in the background. Never throws and never waits:
 * a store that is down costs nothing but the list, and says so once. A
 * refused request (401, 403 — a blocked account) is not someone being here.
 */
export function createPresenceRecorder(store: () => Promise<PresenceStore | null>, opts: PresenceRecorderOptions = {}) {
  const now = opts.now ?? Date.now
  const writeEveryMs = opts.writeEveryMs ?? PRESENCE_WRITE_EVERY_MS
  const maxTracked = opts.maxTracked ?? 10_000
  const log = opts.log ?? ((message: string) => console.warn(message))
  // Insertion order is recency: a write moves its pair to the end, so the first is the least recent.
  const lastWrite = new Map<string, number>()
  let failing = false

  return function recordPresence(req: FastifyRequest, statusCode: number): void {
    if (statusCode === 401 || statusCode === 403) return
    const at = now()
    const entry = presenceOf(req, at)
    if (!entry) return
    const key = `${entry.userId}|${surfaceKey(entry)}`
    const last = lastWrite.get(key)
    if (last !== undefined && at - last < writeEveryMs) return
    lastWrite.delete(key)
    lastWrite.set(key, at)
    while (lastWrite.size > maxTracked) lastWrite.delete(lastWrite.keys().next().value!)
    void store()
      .then((s) => s?.put(entry))
      .then(
        () => {
          failing = false
        },
        (error: unknown) => {
          // Not written: the next request may try again rather than wait out the throttle.
          if (lastWrite.get(key) === at) lastWrite.delete(key)
          if (!failing) log(`[presence] could not note a signed-in visit: ${error instanceof Error ? error.message : String(error)}`)
          failing = true
        },
      )
  }
}
