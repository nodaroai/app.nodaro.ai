/**
 * Site Capture on Apify: one actor run loads the page once, the page function
 * (site-capture-page.ts) writes FULL_PAGE and STILL_<i> to the run's key-value
 * store and returns the section map as the dataset item. This module reads them
 * back and maps every failure to a SiteCaptureError with a public message.
 *
 * SiteCaptureError is NOT an ApifyError and never passes through
 * sanitizeApifyError's message rewriting (that function only writes the internal
 * log line here): a verdict message mentioning "blocked" or "timeout" must not come
 * back as a scrape message.
 */
import type { ActorRun, ApifyClient } from "apify-client"
import { getApifyClient, sanitizeApifyError } from "./client.js"
import { MissingProviderKeyError } from "../provider-keys.js"
import { SITE_CAPTURE_ACTOR } from "./site-capture-actor.js"
import {
  buildPageFunctionSource,
  FULL_PAGE_MAX_CSS_PX,
  STILL_ASPECT,
  type CaptureItem,
  type PlannedSection,
  type SectionCategory,
} from "./site-capture-page.js"
import { SITE_CAPTURE_MESSAGES } from "../../lib/site-capture-codes.js"

export type SiteCaptureCode = "site_blocked" | "site_empty" | "site_unreachable" | "capture_timeout" | "capture_failed"

export class SiteCaptureError extends Error {
  constructor(
    readonly code: SiteCaptureCode,
    readonly publicMessage: string,
    readonly internalDetails: string,
    readonly providerRunId?: string,
  ) {
    super(publicMessage)
    this.name = "SiteCaptureError"
  }
}

/** The largest record kept — equal to IMPORT_MAX_BYTES (lib/media-import.ts), pinned by site-capture-store.test.ts. */
export const CAPTURE_RECORD_MAX_BYTES = 20 * 1024 * 1024

export interface CapturedImage {
  bytes: Buffer
  contentType: string
}

export interface CapturedStill extends CapturedImage {
  index: number
  sectionOrder: number
  label: string
  category: SectionCategory
}

export interface SiteCaptureRun {
  providerRunId: string
  finalUrl: string
  title: string
  lang: string | null
  dir: "ltr" | "rtl"
  device: { width: number; height: number; dpr: number }
  fullPage: (CapturedImage & { truncated: boolean }) | null
  stills: CapturedStill[]
  sections: PlannedSection[]
  pageText: string
  warnings: string[]
}

export interface CaptureLog {
  warn(obj: object, msg: string): void
}

const SILENT: CaptureLog = { warn: () => undefined }
const VERDICT_CODE = { blocked: "site_blocked", empty: "site_empty", unreachable: "site_unreachable" } as const
const NAV_UNREACHABLE = /ERR_NAME_NOT_RESOLVED|ENOTFOUND|getaddrinfo|ERR_CONNECTION_(REFUSED|RESET|CLOSED)|ECONNREFUSED|ERR_ADDRESS_UNREACHABLE|ERR_CERT_|ERR_SSL_|SSL_ERROR|certificate|ERR_TLS/i
const NAV_TIMEOUT = /timeout|timed out|ERR_TIMED_OUT/i

const fail = (code: SiteCaptureCode, details: string, runId?: string): SiteCaptureError =>
  new SiteCaptureError(code, SITE_CAPTURE_MESSAGES[code], details, runId)

/**
 * The actor input for one capture. Our own actor owns the phone context, so it takes only the page,
 * the page script, the still count and the proxy setting; a generic scraper also needs its crawl
 * limits and the phone input.
 */
export function buildSiteCaptureInput(url: string, maxStills: number): Record<string, unknown> {
  const def = SITE_CAPTURE_ACTOR
  const pageScript = buildPageFunctionSource({ maxStills, stillAspect: STILL_ASPECT, fullPageMaxCssPx: FULL_PAGE_MAX_CSS_PX, stillFormat: def.stillFormat })
  if (def.option === "B-prime") return { url, maxStills, pageScript, proxyConfiguration: def.proxyConfiguration }
  return {
    startUrls: [{ url }],
    maxRequestsPerCrawl: 1,
    maxRequestRetries: 1,
    pageFunction: pageScript,
    proxyConfiguration: def.proxyConfiguration,
    ...def.deviceInput,
  }
}

/** The error messages an `#error` item carries — never the rest of the row, which holds the page address. */
function errorMessagesOf(row: Record<string, unknown>): string[] {
  const debug = row["#debug"]
  const lists = [row.errorMessages, debug && typeof debug === "object" ? (debug as Record<string, unknown>).errorMessages : undefined]
  return lists.flatMap((list) => (Array.isArray(list) ? list.filter((m): m is string => typeof m === "string") : []))
}

/**
 * No capture item: the page never loaded (or the page script threw). Read the error wherever the actor
 * left it: an `#error` dataset item, the request queue (generic scrapers), or the run's status message.
 */
async function navigationFailure(client: ApifyClient, run: ActorRun, rows: ReadonlyArray<Record<string, unknown>>): Promise<SiteCaptureError> {
  const texts: string[] = rows.filter((r) => r["#error"]).flatMap(errorMessagesOf)
  try {
    const { items } = await client.requestQueue(run.defaultRequestQueueId).listRequests({ limit: 10 })
    for (const request of items) texts.push(...(request.errorMessages ?? []))
  } catch {
    // Our own actor creates no request queue; the other two sources remain.
  }
  if (run.statusMessage) texts.push(run.statusMessage)
  const all = texts.join("\n")
  const code: SiteCaptureCode = NAV_UNREACHABLE.test(all) ? "site_unreachable" : NAV_TIMEOUT.test(all) ? "capture_timeout" : "capture_failed"
  return fail(code, all.slice(0, 2000) || "the run produced no capture", run.id)
}

/**
 * Each delete runs on its own: a failure — a rejection, or a synchronous throw from the client — is
 * logged and never fails the capture. A storage that was never created answers 404, which the client
 * already treats as done.
 */
async function deleteRunStorages(client: ApifyClient, run: ActorRun, log: CaptureLog): Promise<void> {
  const deletes: Array<[string, () => Promise<void>]> = [
    ["key-value store", () => client.keyValueStore(run.defaultKeyValueStoreId).delete()],
    ["dataset", () => client.dataset(run.defaultDatasetId).delete()],
    ["request queue", () => client.requestQueue(run.defaultRequestQueueId).delete()],
  ]
  await Promise.all(
    deletes.map(async ([storage, del]) => {
      try {
        await del()
      } catch (err) {
        log.warn({ err, runId: run.id, storage }, "[site-capture] a run storage could not be deleted")
      }
    }),
  )
}

export async function runSiteCapture(args: { url: string; maxStills: number }, log: CaptureLog = SILENT): Promise<SiteCaptureRun> {
  // The only token access. On an install with no key and no connection this
  // throws MissingProviderKeyError, which the route shows verbatim.
  const client = getApifyClient()
  const def = SITE_CAPTURE_ACTOR
  let runId: string | undefined
  try {
    const run = await client.actor(def.apifyActorId).call(buildSiteCaptureInput(args.url, args.maxStills), {
      build: def.build,
      memory: def.memoryMbytes,
      timeout: def.runTimeoutSecs,
      waitSecs: def.waitSecs,
      log: null,
    })
    runId = run.id
    if (run.status === "READY" || run.status === "RUNNING") {
      await client.run(run.id).abort().catch((err: unknown) => log.warn({ err, runId: run.id }, "[site-capture] abort failed"))
      throw fail("capture_timeout", `run still ${run.status} after ${def.waitSecs} s`, run.id)
    }
    if (run.status === "TIMED-OUT" || run.status === "TIMING-OUT") throw fail("capture_timeout", `run ${run.status}`, run.id)

    const { items } = await client.dataset(run.defaultDatasetId).listItems()
    const rows = items as Array<Record<string, unknown>>
    const item = rows.find((r) => typeof r.verdict === "string") as CaptureItem | undefined
    // A 401/403/429 page still loads, so it arrives here as the page's own verdict, not as a navigation error.
    if (!item) throw await navigationFailure(client, run, rows)
    if (item.verdict !== "ok") throw fail(VERDICT_CODE[item.verdict], `verdict ${item.verdict}, status ${String(item.status)}`, run.id)

    const store = client.keyValueStore(run.defaultKeyValueStoreId)
    const read = async (key: string): Promise<CapturedImage | "missing" | "oversize"> => {
      const rec = await store.getRecord(key, { buffer: true })
      if (!rec) return "missing"
      const bytes = Buffer.from(rec.value as Buffer)
      if (bytes.length > CAPTURE_RECORD_MAX_BYTES) return "oversize"
      return { bytes, contentType: rec.contentType ?? "application/octet-stream" }
    }
    const warnings = [...item.warnings]
    const stills: CapturedStill[] = []
    for (const s of item.stills) {
      const got = await read(s.key)
      if (got === "missing") warnings.push(`still_missing:${s.index}`)
      else if (got === "oversize") warnings.push(`still_dropped_oversize:${s.index}`)
      else stills.push({ ...got, index: s.index, sectionOrder: s.sectionOrder, label: s.label, category: s.category })
    }
    const full = await read(item.fullPage.key)
    if (full === "missing") warnings.push("full_page_missing")
    if (full === "oversize") warnings.push("full_page_dropped_oversize")
    const fullPage = typeof full === "object" ? { ...full, truncated: item.fullPage.truncated } : null

    if (def.deleteStoragesAfterSuccess) await deleteRunStorages(client, run, log)
    return {
      providerRunId: run.id,
      finalUrl: item.finalUrl,
      title: item.title,
      lang: item.lang,
      dir: item.dir,
      device: item.device,
      fullPage,
      stills,
      sections: item.sections,
      pageText: item.pageText,
      warnings,
    }
  } catch (err) {
    if (err instanceof SiteCaptureError || err instanceof MissingProviderKeyError) throw err
    // The sanitizer's log line only; its 401/403/404 branches describe Apify's API, not the site.
    const details = sanitizeApifyError(err, "site-capture").internalDetails
    throw fail(/timeout/i.test(details) ? "capture_timeout" : "capture_failed", details, runId)
  }
}
