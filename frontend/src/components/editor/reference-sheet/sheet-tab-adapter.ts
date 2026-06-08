import type { EntityKind } from "@nodaro/shared"
import {
  generateCharacterAsset,
  generateObjectAsset,
  generateLocationAsset,
  getJobStatusLean,
} from "@/lib/api"

/**
 * Per-entity bridge for `<ReferenceSheetTab>`.
 *
 * The three studio hooks are NOT symmetric (verified against the real hooks):
 *  - **character** (`use-character-studio.ts`): staged data is `studio.staged`;
 *    persist via `studio.ensureSaved()`. We deliberately do NOT use the
 *    `useCharacterStudioJobs` `trackAndWait` per-call awaitable here: it routes
 *    the resolved url through the modal's `onResolved` staged-array merge, which
 *    files the panel into the bucket its assetType maps to — so every sheet panel
 *    (expressions/poses/angles/detail/wardrobe) would land in one bucket. Instead
 *    we await via the same `getJobStatusLean` poll loop as object/location and let
 *    the worker's `attachToColumn` auto-attach place each panel in the right column.
 *  - **object/location** (`use-{object,location}-studio.ts`): staged data is
 *    `studio.stagedData`; persist via `studio.ensureSavedBeforeGen()`; jobs hook
 *    (`use{Object,Location}StudioJobs`) only has `trackJob({jobId,assetType,name})`
 *    plus `onResolved(cb)`/`onFailed(cb)` SETTERS (the latest cb wins; they're
 *    the modal-level merge callbacks, NOT free per-call subscriptions). So a
 *    single panel job is awaited via `trackJob` + a local `getJobStatusLean`
 *    poll loop — registering an `onResolved` per panel would clobber the modal's
 *    callback and only allow one waiter.
 *
 * `studio`/`jobs` are typed `any` because the three hooks are unrelated shapes;
 * a typed union of three differently-shaped hooks would be more noise than
 * safety. The `any` is contained to THIS file — the component consumes the
 * narrow `SheetTabAdapter` interface only.
 */
export interface SheetTabAdapter {
  entityKind: EntityKind
  /** The staged entity data (character: studio.staged; object/location: studio.stagedData). */
  getStaged: (studio: any) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Persist + return the entity DB id (character: ensureSaved; object/location: ensureSavedBeforeGen). */
  ensureSaved: (studio: any) => Promise<string> // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Entity buckets keyed by DB COLUMN (snake_case) for planSheetGeneration. */
  bucketsByColumn: (staged: any) => Record<string, Array<{ name?: string; url?: string }> | undefined> // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Fire one generate-*-asset for a missing panel; return its jobId. */
  generateAsset: (
    dbId: string,
    req: { assetType: string; variant: string; attachToColumn: string; attachName: string; userPrompt?: string; name: string; sourceImageUrl?: string },
  ) => Promise<{ jobId: string }>
  /** Await a tracked job to completion → resolved image URL. All three entities
   *  poll `getJobStatusLean` directly (the worker's `attachToColumn` auto-attach
   *  handles bucket placement; the modal's staged-merge is bypassed). */
  awaitJob: (jobs: any, jobId: string, assetType: string, name: string) => Promise<string> // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Set a sheet url as the node thumbnail (per-canvas-node defaultAssetUrl). */
  setThumbnail: (studio: any, url: string, name: string) => void // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const SHEET_TAB_ADAPTERS: Record<EntityKind, SheetTabAdapter> = {
  character: {
    entityKind: "character",
    getStaged: (s) => s.staged,
    ensureSaved: (s) => s.ensureSaved(),
    bucketsByColumn: (st) => ({
      angles: st.angles, body_angles: st.bodyAngles, expressions: st.expressions, poses: st.poses,
      lighting_variations: st.lightingVariations, detail_closeups: st.detailCloseups, outfit_variations: st.outfitVariations,
    }),
    generateAsset: (dbId, r) =>
      generateCharacterAsset({
        assetType: r.assetType as never, variant: r.variant, name: r.name, userPrompt: r.userPrompt,
        sourceImageUrl: r.sourceImageUrl, attachToCharacterId: dbId, attachToColumn: r.attachToColumn as never, attachName: r.attachName,
      }),
    // Await via the same getJobStatusLean poll loop as object/location — NOT the
    // modal's `trackAndWait`. `trackAndWait` routes the resolved url through the
    // modal's `onResolved` staged-array merge, which keys off the assetType and
    // would file EVERY sheet panel (expressions/poses/body-angles/detail/wardrobe)
    // into whatever bucket that assetType maps to. The worker already auto-attaches
    // each panel to the correct DB column via `attachToColumn`; polling the job
    // directly bypasses the staged-merge so buckets aren't cross-contaminated in
    // session. `jobs` is unused here (the poll registers via trackJob, a no-op for
    // the character hook) but kept for signature symmetry with object/location.
    awaitJob: (jobs, jobId, _assetType, name) => awaitViaPoll(jobs, jobId, name),
    setThumbnail: (s, url, name) => s.patch({ defaultAssetUrl: url, defaultAssetName: name }),
  },
  object: {
    entityKind: "object",
    getStaged: (s) => s.stagedData,
    ensureSaved: (s) => s.ensureSavedBeforeGen(),
    bucketsByColumn: (st) => ({ angles: st.angles, materials: st.materials, variations: st.variations, detail_closeups: st.detailCloseups }),
    generateAsset: (dbId, r) =>
      generateObjectAsset({
        assetType: r.assetType as never, variant: r.variant, name: r.name, userPrompt: r.userPrompt,
        sourceImageUrl: r.sourceImageUrl ?? "", attachToObjectId: dbId, attachToColumn: r.attachToColumn as never, attachName: r.attachName,
      }),
    awaitJob: (jobs, jobId, _assetType, name) => awaitViaPoll(jobs, jobId, name),
    setThumbnail: (s, url, name) => s.patch({ defaultAssetUrl: url, defaultAssetName: name }),
  },
  location: {
    entityKind: "location",
    getStaged: (s) => s.stagedData,
    ensureSaved: (s) => s.ensureSavedBeforeGen(),
    bucketsByColumn: (st) => ({ angles: st.angles, time_of_day: st.timeOfDay, weather: st.weather, seasons: st.seasons, lighting: st.lighting, detail_closeups: st.detailCloseups }),
    generateAsset: (dbId, r) =>
      generateLocationAsset({
        // Pass the establishing shot so sheet panels are image-to-image off it
        // (the sheet flow always has a main image — it's gated). NOTE: this is the
        // sheet path only; the Location Studio's environmental tabs call
        // generateLocationAsset directly and intentionally omit sourceImageUrl
        // when Style Lock is OFF (text-only) — that toggle is unaffected.
        assetType: r.assetType as never, variant: r.variant, name: r.name, userPrompt: r.userPrompt,
        sourceImageUrl: r.sourceImageUrl, attachToLocationId: dbId, attachToColumn: r.attachToColumn as never, attachName: r.attachName,
      }),
    awaitJob: (jobs, jobId, _assetType, name) => awaitViaPoll(jobs, jobId, name),
    setThumbnail: (s, url, name) => s.patch({ defaultAssetUrl: url, defaultAssetName: name }),
  },
}

/**
 * Object/location jobs hooks have NO per-call awaitable — their
 * `onResolved`/`onFailed` are singular setters owned by the modal-level merge.
 * So we register the job with `trackJob` (so the worker auto-attach + the
 * modal's grid placeholder still fire), then poll `getJobStatusLean` directly
 * for THIS panel's terminal state. Resolves the panel's image URL; rejects on
 * failed/cancelled. 2s cadence mirrors the in-flight node poll loops.
 */
const PANEL_POLL_MS = 2000
const PANEL_POLL_MAX_ATTEMPTS = 150 // ~5 min ceiling so a stuck job can't hang the chain forever

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function awaitViaPoll(jobs: any, jobId: string, name: string): Promise<string> {
  // Register so the worker auto-attaches to the entity row's bucket and the
  // modal renders a placeholder card; we don't rely on the hook's callbacks.
  // Object/Location jobs hooks expose trackJob; the Character hook doesn't (it
  // uses track/trackAndWait), so feature-detect rather than swallow a TypeError.
  if (typeof jobs?.trackJob === "function") jobs.trackJob({ jobId, assetType: "sheet-panel", name })
  return new Promise<string>((resolve, reject) => {
    let attempts = 0
    const tick = async () => {
      attempts += 1
      try {
        const job = await getJobStatusLean(jobId)
        if (job.status === "completed") {
          const out = job.output_data as { imageUrl?: string; videoUrl?: string } | undefined
          const url = out?.imageUrl ?? out?.videoUrl
          if (url) { resolve(url); return }
          reject(new Error("Panel completed without a usable URL"))
          return
        }
        if (job.status === "failed" || job.status === "cancelled") {
          reject(new Error(job.error_message ?? `panel ${job.status}`))
          return
        }
      } catch {
        // transient — retry next tick
      }
      if (attempts >= PANEL_POLL_MAX_ATTEMPTS) {
        reject(new Error("panel generation timed out"))
        return
      }
      setTimeout(() => { void tick() }, PANEL_POLL_MS)
    }
    setTimeout(() => { void tick() }, PANEL_POLL_MS)
  })
}
