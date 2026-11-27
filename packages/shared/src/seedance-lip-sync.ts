/**
 * What a Seedance Lip Sync run renders and is priced at — ONE rule for the
 * route, the workflow run, the editor's estimate and the worker (decided
 * 2026-11-16).
 *
 * A Seedance Lip Sync run (the Seedance 2 family on the Lip Sync node: one
 * portrait plus the voice line as reference AUDIO, no reference video) renders
 * a fixed {@link SEEDANCE_LIP_SYNC_SECONDS}-second clip. The provider bills it
 * at the model's plain per-second rate — a reference video is what moves a
 * Seedance run onto the `-ref` rate (input + output seconds), and this run has
 * none — so it is priced on the plain row `<model>:8s:<resolution>`.
 *
 * The resolution is the one asked when the model renders it, else the model's
 * top catalog tier (a 1080p asked of Seedance 2 Fast renders and bills 720p;
 * on Seedance 2.5 its top tier below 4K — only an explicit 4K is 4K there),
 * and 720p when none is asked. Every catalog tier of every family member has a
 * plain 8-second row. The worker sends this same resolution, so what renders is
 * what was priced.
 *
 * MiniMax Hailuo 3 rides the same Lip Sync lane but is no Seedance model: it is
 * priced and sent on its own rule (`minimax-h3:8s`), never here.
 */
import { MODEL_CATALOG } from "./model-catalog.js"
import { SEEDANCE_LIP_SYNC_PROVIDERS, isMinimaxH3Provider, isSeedance2Provider } from "./model-constants.js"
import { explicitFourKOf, resolutionsALooseRequestMayLandOn } from "./explicit-4k.js"

/** The length, in seconds, a Seedance Lip Sync run renders and is priced at. */
export const SEEDANCE_LIP_SYNC_SECONDS = 8

/** The resolution a Seedance Lip Sync run uses when none is asked. */
const SEEDANCE_LIP_SYNC_DEFAULT_RESOLUTION = "720p"

/** Whether this Lip Sync model is a Seedance model priced by {@link seedanceLipSyncCreditId}. */
export function isSeedanceLipSyncProvider(provider: unknown): provider is string {
  return typeof provider === "string" && SEEDANCE_LIP_SYNC_PROVIDERS.has(provider) && isSeedance2Provider(provider)
}

/** The resolution a Seedance Lip Sync run renders and is priced at (see the file comment). */
export function seedanceLipSyncResolution(provider: string, resolution?: unknown): string {
  const supported = MODEL_CATALOG[provider]?.resolutions ?? []
  const want = typeof resolution === "string" && resolution !== "" ? resolution : SEEDANCE_LIP_SYNC_DEFAULT_RESOLUTION
  if (supported.includes(want)) return want
  // On Seedance 2.5 a 4K spelling (`4K`, `2160p`, `UHD`) is 4K (decided 2026-11-27).
  const fourK = explicitFourKOf(provider, want)
  if (fourK && supported.includes(fourK)) return fourK
  // A size the model does not list lands on its top tier — on a model where
  // only an explicit 4K means 4K (Seedance 2.5, decided 2026-11-25), its top
  // tier below 4K (1080p), where such a size landed before 4K was listed.
  const landing = resolutionsALooseRequestMayLandOn(provider, want, supported)
  return landing[landing.length - 1] ?? SEEDANCE_LIP_SYNC_DEFAULT_RESOLUTION
}

/** The credit id a Seedance Lip Sync run is held and charged on: its plain 8-second row. */
export function seedanceLipSyncCreditId(provider: string, resolution?: unknown): string {
  return `${provider}:${SEEDANCE_LIP_SYNC_SECONDS}s:${seedanceLipSyncResolution(provider, resolution)}`
}

/**
 * MiniMax Hailuo 3 on Lip Sync: the same portrait-plus-voice-line run, held on
 * its 8-second 2K row on every path (decided 2026-11-16). The Lip Sync
 * resolution never names H3's own 768P tier, and KIE renders 2K when none is
 * sent, so the row does not follow the resolution and nothing sent changes.
 */
export const MINIMAX_H3_LIP_SYNC_CREDIT_ID = `minimax-h3:${SEEDANCE_LIP_SYNC_SECONDS}s`

/**
 * The credit id a Lip Sync run on a multimodal video model (the Seedance 2
 * family and MiniMax Hailuo 3: a portrait plus the voice line as reference
 * audio) is held and charged on — the ONE rule the route, the workflow run,
 * the film pipeline and both estimates read. Undefined for every other Lip
 * Sync model.
 */
export function referenceAudioLipSyncCreditId(provider: unknown, resolution?: unknown): string | undefined {
  if (isSeedanceLipSyncProvider(provider)) return seedanceLipSyncCreditId(provider, resolution)
  if (typeof provider === "string" && isMinimaxH3Provider(provider)) return MINIMAX_H3_LIP_SYNC_CREDIT_ID
  return undefined
}
