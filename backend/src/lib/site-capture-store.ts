/**
 * Site Capture's stored screenshots. Each still and the full page becomes one of
 * the user's assets, hidden from the media picker until saved (the scraped-media
 * policy), after the upload policy's "site-capture" lane allows it. Also: the
 * cleanup when a capture is cancelled, blocked by a result policy or runs out of
 * storage, and the re-store of a relayed capture's cloud images.
 *
 * Every assets read and delete here is scoped by user_id.
 */
import { applyUploadPolicies } from "./upload-policy.js"
import { IMPORT_MAX_BYTES, readBodyCapped, storeImportedImageBuffer } from "./media-import.js"
import { permanentlyDeleteAsset, type OwnedAssetRow } from "./asset-delete.js"
import { isStorageConfigured } from "./storage.js"
import { safeFetch } from "./safe-fetch.js"
import { supabase } from "./supabase.js"
import { extractPageFacts } from "../providers/apify/site-capture-facts.js"
import type { SiteCaptureRun } from "../providers/apify/site-capture.js"
import type { Rect, SectionCategory, SectionKind } from "../providers/apify/site-capture-page.js"

export interface CaptureStillOut {
  index: number
  sectionOrder: number
  label: string
  category: SectionCategory
  /** null only on a relayed capture this install could not store. */
  assetId: string | null
  url: string
  width: number
  height: number
}

export interface CaptureSectionOut {
  order: number
  label: string
  category: SectionCategory
  kind: SectionKind
  rect: Rect
  text: string
  stillIndex: number | null
}

/** jobs.output_data of a completed capture. No top-level url / imageUrl / videoUrl on purpose. */
export interface CaptureOutput {
  pageUrl: string
  finalUrl: string
  title: string
  lang: string | null
  dir: "ltr" | "rtl"
  device: { width: number; height: number; dpr: number }
  fullPage: { assetId: string | null; url: string; width: number; height: number; truncated: boolean } | null
  stills: CaptureStillOut[]
  sections: CaptureSectionOut[]
  facts: string[]
  usableStills: number
  warnings: string[]
  source: "local" | "relay"
}

export interface CaptureContext {
  userId: string
  jobId: string
  /** The address as requested, after normalisation. */
  pageUrl: string
}

export interface StoredCapture {
  output: CaptureOutput
  /** Every asset row this capture wrote, for cleanup. */
  assetIds: string[]
}

/** The user's storage is full. The rows this capture wrote are already deleted. */
export class CaptureStorageFullError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CaptureStorageFullError"
  }
}

type StoreResult =
  | { ok: true; assetId: string; url: string; width: number; height: number }
  | { ok: false; reason: "refused" | "store_failed" | "storage_limit_exceeded"; message: string }

export function sniffImageMime(bytes: Buffer): "image/png" | "image/jpeg" {
  return bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 ? "image/png" : "image/jpeg"
}

const extOf = (bytes: Buffer): string => (sniffImageMime(bytes) === "image/png" ? "png" : "jpg")

function hostOf(...urls: readonly string[]): string {
  for (const u of urls) {
    try {
      return new URL(u).hostname
    } catch {
      // try the next one
    }
  }
  return "site"
}

/** One image: the upload policy, then the shared import pipeline (decode, quota, R2, thumbnail, row). */
export async function storeCaptureImage(args: { userId: string; jobId: string; bytes: Buffer; filename: string; sourceUrl: string; hostname: string }): Promise<StoreResult> {
  const decision = await applyUploadPolicies({
    kind: "image",
    lane: "site-capture",
    mime: sniffImageMime(args.bytes),
    sizeBytes: args.bytes.length,
    userId: args.userId,
    filename: args.filename,
    buffer: args.bytes,
  })
  if (!decision.allow) return { ok: false, reason: "refused", message: decision.reason ?? "refused by the upload policy" }
  try {
    const res = await storeImportedImageBuffer({
      userId: args.userId,
      body: args.bytes,
      uploadSource: "url_import",
      sourceUrl: args.sourceUrl,
      filename: args.filename,
      source: "site-capture",
      sourceDetail: args.hostname,
      inLibrary: false,
      jobId: args.jobId,
    })
    if (!res.ok) return { ok: false, reason: res.code === "storage_limit_exceeded" ? "storage_limit_exceeded" : "store_failed", message: res.message }
    if (res.assetId === null) return { ok: false, reason: "store_failed", message: "the asset row was not written" }
    return { ok: true, assetId: res.assetId, url: res.url, width: res.width, height: res.height }
  } catch (err) {
    return { ok: false, reason: "store_failed", message: err instanceof Error ? err.message : String(err) }
  }
}

/** Delete the rows a capture wrote (cancelled, blocked, or storage full). Scoped by user. */
export async function deleteCaptureAssets(userId: string, assetIds: readonly string[]): Promise<void> {
  for (const id of assetIds) {
    const { data: row, error } = await supabase
      .from("assets")
      .select("id, r2_key, size_bytes, job_id, relay_job_id")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle()
    if (error || !row) continue
    await permanentlyDeleteAsset({ userId, asset: row as OwnedAssetRow, blockOnOwnJobReferrers: false }).catch((err: unknown) => {
      console.error(`[site-capture] could not delete asset ${id}:`, err instanceof Error ? err.message : err)
    })
  }
}

/** A relayed capture's cloud image, through safeFetch, under the import cap; null when it cannot be read. */
export async function fetchRelayImage(url: string): Promise<Buffer | null> {
  try {
    const res = await safeFetch(url, { timeoutMs: 30_000 })
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined)
      return null
    }
    return await readBodyCapped(res, IMPORT_MAX_BYTES)
  } catch {
    return null
  }
}

/** Re-number the delivered stills 0…n-1 in page order and point each section at its still. */
function renumber(kept: readonly CaptureStillOut[], sections: readonly CaptureSectionOut[]): { stills: CaptureStillOut[]; sections: CaptureSectionOut[] } {
  const stills = kept.map((s, i) => ({ ...s, index: i }))
  const bySection = new Map(stills.map((s) => [s.sectionOrder, s.index]))
  return {
    stills,
    sections: sections.map((s) => ({ order: s.order, label: s.label, category: s.category, kind: s.kind, rect: s.rect, text: s.text, stillIndex: bySection.get(s.order) ?? null })),
  }
}

const withMinimum = (warnings: readonly string[], usable: number): string[] => {
  const rest = warnings.filter((w) => w !== "sections_below_minimum")
  return usable < 3 ? [...rest, "sections_below_minimum"] : rest
}

/** A local run: store stills in page order, then the full page. */
export async function storeLocalCapture(run: SiteCaptureRun, ctx: CaptureContext): Promise<StoredCapture> {
  const hostname = hostOf(run.finalUrl, ctx.pageUrl)
  const assetIds: string[] = []
  const warnings = [...run.warnings]
  const kept: CaptureStillOut[] = []
  const save = (bytes: Buffer, filename: string) =>
    storeCaptureImage({ userId: ctx.userId, jobId: ctx.jobId, bytes, filename, sourceUrl: run.finalUrl, hostname })
  const storageFull = async (message: string): Promise<never> => {
    await deleteCaptureAssets(ctx.userId, assetIds)
    throw new CaptureStorageFullError(message)
  }

  for (const s of run.stills) {
    const r = await save(s.bytes, `${hostname}-${s.index}-${s.category}.${extOf(s.bytes)}`)
    if (r.ok) {
      assetIds.push(r.assetId)
      kept.push({ index: s.index, sectionOrder: s.sectionOrder, label: s.label, category: s.category, assetId: r.assetId, url: r.url, width: r.width, height: r.height })
    } else if (r.reason === "storage_limit_exceeded") {
      await storageFull(r.message)
    } else {
      warnings.push(r.reason === "refused" ? `still_refused:${s.index}` : `still_store_failed:${s.index}`)
    }
  }

  let fullPage: CaptureOutput["fullPage"] = null
  if (run.fullPage) {
    const r = await save(run.fullPage.bytes, `${hostname}-full.${extOf(run.fullPage.bytes)}`)
    if (r.ok) {
      assetIds.push(r.assetId)
      fullPage = { assetId: r.assetId, url: r.url, width: r.width, height: r.height, truncated: run.fullPage.truncated }
    } else if (r.reason === "storage_limit_exceeded") {
      await storageFull(r.message)
    } else {
      warnings.push(r.reason === "refused" ? "full_page_refused" : "full_page_store_failed")
    }
  }

  const { stills, sections } = renumber(kept, run.sections)
  return {
    assetIds,
    output: {
      pageUrl: ctx.pageUrl,
      finalUrl: run.finalUrl,
      title: run.title,
      lang: run.lang,
      dir: run.dir,
      device: run.device,
      fullPage,
      stills,
      sections,
      facts: extractPageFacts([run.pageText, ...run.sections.map((s) => s.text)].join("\n")),
      usableStills: stills.length,
      warnings: withMinimum(warnings, stills.length),
      source: "local",
    },
  }
}

/** A relayed run: the cloud's output, its images stored again on this install when it has storage. */
export async function restoreRelayCapture(cloud: Record<string, unknown>, ctx: CaptureContext): Promise<StoredCapture> {
  const out = cloud as Partial<CaptureOutput>
  const finalUrl = typeof out.finalUrl === "string" ? out.finalUrl : ctx.pageUrl
  const hostname = hostOf(finalUrl, ctx.pageUrl)
  const local = isStorageConfigured()
  const assetIds: string[] = []
  const warnings = [...(out.warnings ?? [])]
  let urlsOnly = false
  const restore = async (url: string, base: string): Promise<StoreResult | null> => {
    if (!local) return null
    const bytes = await fetchRelayImage(url)
    if (!bytes) return { ok: false, reason: "store_failed", message: "the cloud image could not be read" }
    return storeCaptureImage({ userId: ctx.userId, jobId: ctx.jobId, bytes, filename: `${base}.${extOf(bytes)}`, sourceUrl: finalUrl, hostname })
  }

  const kept: CaptureStillOut[] = []
  for (const s of out.stills ?? []) {
    const r = await restore(s.url, `${hostname}-${s.index}-${s.category}`)
    if (r?.ok) {
      assetIds.push(r.assetId)
      kept.push({ ...s, assetId: r.assetId, url: r.url, width: r.width, height: r.height })
    } else if (r && !r.ok && r.reason === "refused") {
      warnings.push(`still_refused:${s.index}`)
    } else {
      urlsOnly = true
      kept.push({ ...s, assetId: null })
    }
  }

  let fullPage: CaptureOutput["fullPage"] = null
  if (out.fullPage) {
    const r = await restore(out.fullPage.url, `${hostname}-full`)
    if (r?.ok) {
      assetIds.push(r.assetId)
      fullPage = { ...out.fullPage, assetId: r.assetId, url: r.url, width: r.width, height: r.height }
    } else if (r && !r.ok && r.reason === "refused") {
      warnings.push("full_page_refused")
    } else {
      urlsOnly = true
      fullPage = { ...out.fullPage, assetId: null }
    }
  }

  const { stills, sections } = renumber(kept, out.sections ?? [])
  return {
    assetIds,
    output: {
      pageUrl: ctx.pageUrl,
      finalUrl,
      title: typeof out.title === "string" ? out.title : "",
      lang: typeof out.lang === "string" ? out.lang : null,
      dir: out.dir === "rtl" ? "rtl" : "ltr",
      device: out.device ?? { width: 412, height: 915, dpr: 2.625 },
      fullPage,
      stills,
      sections,
      facts: Array.isArray(out.facts) ? out.facts : [],
      usableStills: stills.length,
      warnings: withMinimum(urlsOnly ? [...warnings, "relay_urls_only"] : warnings, stills.length),
      source: "relay",
    },
  }
}
