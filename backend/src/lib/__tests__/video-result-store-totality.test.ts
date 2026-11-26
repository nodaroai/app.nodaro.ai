// @test-watches backend/src/**/*.ts
/**
 * TOTALITY: every stored video result goes through the video result funnel
 * (`lib/video-result-store.ts`, decided 2026-11-22).
 *
 * The funnel is where a provider's file is kept as the original beside its
 * browser-safe preview, and where a watermarked run stores nothing but the
 * watermarked file. A video stored past it can skip either rule: an original
 * flattened for good, or an unwatermarked picture at a key anyone can derive
 * from the job id.
 *
 * So the census is taken over the code: every call in `backend/src` that
 * stores a video (a storage writer handed `"video"` or a `video/` content
 * type, or naming a video key), that makes one browser-safe
 * (`transcodeToBrowserSafe`, the preview encode) or that watermarks one
 * (`applyVideoWatermark`) is found, keyed `<file> :: <enclosing function>`.
 * It must be the funnel itself, or be listed below with WHY it is not a
 * provider's result. A new site fails this test until someone decides which
 * it is; a listed site that no longer exists fails it too, so the list only
 * holds what is real.
 */
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { eachSourceFile } from "./source-scan.js"

/** The funnel: the one place a video result is stored, made browser-safe or watermarked. */
const FUNNEL = "lib/video-result-store.ts"

/** The storage writers (lib/storage.ts). */
const WRITERS = new Set(["uploadToR2", "uploadFileToR2", "uploadBufferToR2", "uploadFileWithKeyToR2", "uploadLocalFileToR2Key"])
/** The video steps the funnel owns. */
const VIDEO_STEPS = new Set(["transcodeToBrowserSafe", "applyVideoWatermark", "encodeBrowserSafePreview", "browserSafeCopy"])

const OUR_RENDER = "our own render, not a provider's delivered file: an editing or render step that encodes its own H.264 and keeps no original"
const UPLOAD = "a user's upload or import, not a job's delivered result"
const NOT_A_JOB = "not a job's output (a trend's catalog media): the trend owns it"
const PROVIDER_INPUT = "a copy of the user's media made for a provider to read, not a result"
const PLUGIN_HELPER = "a plugin toolkit helper that renders its own clip from the plugin's inputs and hands back a url (our render, no original)"

/**
 * Sites that store or encode a video outside the funnel, keyed
 * `<file> :: <enclosing function>`, each with why.
 */
const OUTSIDE_THE_FUNNEL: Readonly<Record<string, string>> = {
  // ── definitions and plugin members that take a path and give one back ──
  "providers/video/ffmpeg-reading-links.ts :: transcodeToBrowserSafeReadingLinks": "the plugin toolkit's `ffmpeg.transcodeToBrowserSafe` member: a path in, a path out — the plugin stores it and could record no original",
  "providers/video/browser-safe-preview.ts :: browserSafeCopy": "the preview encode's own module (a path in, a path out)",
  // ── our own renders: editing nodes and render pipelines ──
  "workers/shared.ts :: completeFfmpegVideoJob": OUR_RENDER,
  "workers/handlers/ffmpeg.ts :: handleCombineVideos": OUR_RENDER,
  "workers/handlers/ffmpeg.ts :: handleAssembleNarratedVideo": OUR_RENDER,
  "workers/handlers/ffmpeg.ts :: handleTrimVideo": OUR_RENDER,
  "workers/handlers/ffmpeg.ts :: handleSplitMedia": OUR_RENDER,
  "workers/handlers/ffmpeg.ts :: handleApplyEdl": OUR_RENDER,
  "workers/handlers/ffmpeg.ts :: handleAdjustVolume": `${OUR_RENDER} (its video lane re-encodes the user's own picture)`,
  "workers/handlers/ffmpeg.ts :: handlePitchTempo": `${OUR_RENDER} (its video lane re-encodes the user's own picture)`,
  "workers/handlers/mask-outline.ts :: handleMaskOutline": OUR_RENDER,
  "workers/handlers/video-face-mesh.ts :: handleVideoFaceMesh": OUR_RENDER,
  "workers/handlers/video-mask.ts :: handleVideoMask": `${OUR_RENDER} (the mask picture is drawn here from the provider's segmentation)`,
  "workers/render-worker.ts :: createRenderWorker": OUR_RENDER,
  "workers/scene3d-render-child.ts :: processSceneRenderChild": OUR_RENDER,
  "nodes/gif-to-video/worker.ts :: worker": OUR_RENDER,
  "nodes/remove-audio/worker.ts :: worker": `${OUR_RENDER} (the user's own picture with its sound removed)`,
  "providers/video/edl-timeline.ts :: renderEdlTimeline": OUR_RENDER,
  "services/reference-sheet/motion-compositor.ts :: composeMotionSheet": OUR_RENDER,
  "lib/audio-soundtrack.ts :: renderClip": OUR_RENDER,
  "ee/pipelines/services/pipeline-final-merge.ts :: pipelineFinalMerge": OUR_RENDER,
  "workers/handlers/audio-ai.ts :: handleVoiceChanger": `${OUR_RENDER} (the user's own video with the new voice laid on it: the picture is the user's, not a provider's)`,
  "lib/private-plugins/toolkit.ts :: combineVideosToUrl": PLUGIN_HELPER,
  "lib/private-plugins/toolkit.ts :: extractTailToUrl": PLUGIN_HELPER,
  "lib/private-plugins/toolkit.ts :: trimVideoToUrl": PLUGIN_HELPER,
  "lib/private-plugins/toolkit.ts :: renderEdlTimelineToUrl": PLUGIN_HELPER,
  "ee/lib/video-remake-side-by-side-job.ts :: renderSideBySide": `${OUR_RENDER} (Video Remake's side by side, rendered from the run's own files)`,
  "workers/handlers/relay-render-home.ts :: bringRenderHome": "a render the relay target already finished (its own funnel made it browser-safe), copied home as it is",
  // ── uploads, imports, provider inputs and catalog media ──
  "lib/scraped-media.ts :: storeScrapedVideo": UPLOAD,
  "lib/video-download.ts :: runDownloadWithProgress": UPLOAD,
  "routes/save-to-storage.ts :: saveToStorageRoutes": "a sink: Save to Storage copies a url the workflow names, whatever made it, into storage as it is",
  "routes/telegram-webhook.ts :: telegramWebhookRoutes": UPLOAD,
  "workers/handlers/beeble-switchx.ts :: trimSwitchXSource": PROVIDER_INPUT,
  "ee/lib/trends/media.ts :: makeDisplayCopy": NOT_A_JOB,
  "ee/lib/trends/preview-clip-media.ts :: makePreviewClip": NOT_A_JOB,
  "ee/lib/trends/web-copy.ts :: makeWebCopy": NOT_A_JOB,
}

/** The funnel's doors, and where each takes the id it stores under. */
const FUNNEL_DOORS: Readonly<Record<string, "option" | "second">> = {
  storeVideoResult: "option",
  storeVideoAsIs: "option",
  uploadVideoMaybeWatermark: "second",
  watermarkLocalVideoAndUpload: "second",
}

/**
 * Funnel calls whose id is not built from the running job's id where the call
 * is, keyed `<file> :: <id expression>`, each with why it is still the job's.
 */
const ID_FROM_ELSEWHERE: Readonly<Record<string, string>> = {
  "workers/handlers/video-ai.ts :: rawId": "an Extend's raw clip: `jobFileObjectId(ctx.jobId, \"raw\")` on a watermarked run, else `rawExtensionObjectId(ctx.jobId)`, assigned just above the call",
  "lib/private-plugins/toolkit.ts :: jobFileObjectId(getJobId(), \"upscaled\")": "the running job's id (`getJobId()`), with an unguessable suffix",
  "lib/reconcile/fal.ts :: row.id": "a Topaz Rhea upscale's delivery by the reconcile: `row.id` is the id of the very job row it is finalizing",
}

/** An id in the running job's family, as the code spells it at the call. */
const JOB_ID = String.raw`(?:\w+\.)?jobId|job\.id`
const FAMILY_ID = new RegExp(String.raw`^(?:(?:${JOB_ID})|\x60\$\{(?:${JOB_ID})\}-[^\x60/]*\x60|(?:rawExtensionObjectId|jobFileObjectId)\((?:${JOB_ID})\b[^)]*\))$`)
const inFamily = (id: string): boolean => {
  const ternary = /^[^?]+\?\s*(.+?)\s*:\s*(.+)$/.exec(id)
  return ternary ? inFamily(ternary[1]!) && inFamily(ternary[2]!) : FAMILY_ID.test(id)
}

interface IdSite { key: string; id: string; line: number }

function funnelIdSites(): IdSite[] {
  const sites: IdSite[] = []
  eachSourceFile(Object.keys(FUNNEL_DOORS), (sf, rel) => {
    if (rel === FUNNEL || rel === "workers/shared.ts") return
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const name = calleeName(n)
        const door = name ? FUNNEL_DOORS[name] : undefined
        let idNode: ts.Node | undefined
        if (door === "second") idNode = n.arguments[1]
        if (door === "option") {
          const opts = n.arguments[1]
          if (opts && ts.isObjectLiteralExpression(opts)) {
            const prop = opts.properties.find((p) => p.name?.getText(sf) === "jobId")
            idNode = prop && ts.isPropertyAssignment(prop) ? prop.initializer : prop && ts.isShorthandPropertyAssignment(prop) ? prop.name : undefined
          }
        }
        if (door) {
          const id = idNode ? idNode.getText(sf).replace(/\s+/g, " ") : "<unreadable>"
          sites.push({ key: `${rel} :: ${id}`, id, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
        }
      }
      n.forEachChild(visit)
    }
    visit(sf)
  })
  return sites
}

interface Site { key: string; line: number }

/** The name a node gives the functions inside it: a named function or method, or the binding of an arrow / function expression. */
function nameOf(node: ts.Node, sf: ts.SourceFile): string | undefined {
  if ((ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) && node.name) return node.name.getText(sf)
  if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node)) && node.initializer
    && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) return node.name.getText(sf)
  return undefined
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) return e.name.text
  return undefined
}

/** The writers whose third argument is the media type (`uploadFileToR2` defaults it to `"video"`). */
const TYPED_WRITERS: Readonly<Record<string, "video" | "image">> = { uploadFileToR2: "video", uploadToR2: "image" }

/**
 * A writer call that may store a video: handed `"video"`, a `video/` content
 * type, or a key naming one — and, for a typed writer, a media type that is
 * not a literal (it may be `"video"`) or, where the writer defaults to video,
 * none at all.
 */
function storesVideo(call: ts.CallExpression, sf: ts.SourceFile): boolean {
  const name = calleeName(call)
  const fallback = name ? TYPED_WRITERS[name] : undefined
  if (fallback) {
    const type = call.arguments[2]
    if (!type) return fallback === "video"
    if (!ts.isStringLiteralLike(type)) return true
  }
  return call.arguments.some((arg) => {
    if (ts.isStringLiteralLike(arg)) return arg.text === "video" || arg.text.startsWith("video/") || arg.text.startsWith("videos/")
    const text = arg.getText(sf)
    return /["'`]videos\//.test(text) || /VideoKey\(/.test(text)
  })
}

function videoSites(): Site[] {
  const sites: Site[] = []
  eachSourceFile([...WRITERS, ...VIDEO_STEPS], (sf, rel) => {
    if (rel === FUNNEL || rel === "lib/storage.ts" || rel.startsWith("scripts/") || rel.includes("__characterization__")) return
    const visit = (n: ts.Node, fn: string): void => {
      const here = nameOf(n, sf) ?? fn
      if (ts.isCallExpression(n)) {
        const name = calleeName(n)
        if (name && (VIDEO_STEPS.has(name) || (WRITERS.has(name) && storesVideo(n, sf)))) {
          sites.push({ key: `${rel} :: ${here}`, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
        }
      }
      n.forEachChild((c) => visit(c, here))
    }
    visit(sf, "<module>")
  })
  return sites
}

describe("every stored video result goes through the video result funnel", () => {
  const sites = videoSites()

  it("finds no video store, browser-safe encode or watermark outside the funnel that is not listed", () => {
    const unlisted = sites.filter((s) => !(s.key in OUTSIDE_THE_FUNNEL)).map((s) => `${s.key} (line ${s.line})`)
    expect(unlisted, `store these through lib/video-result-store.ts, or list them in OUTSIDE_THE_FUNNEL with why`).toEqual([])
  })

  it("lists no site that no longer exists", () => {
    const found = new Set(sites.map((s) => s.key))
    expect(Object.keys(OUTSIDE_THE_FUNNEL).filter((k) => !found.has(k))).toEqual([])
  })

  it("gives every listed site a reason", () => {
    for (const [key, why] of Object.entries({ ...OUTSIDE_THE_FUNNEL, ...ID_FROM_ELSEWHERE })) expect(why.length, key).toBeGreaterThan(20)
  })
})

describe("every funnel call stores under the running job's own id (its key family)", () => {
  const sites = funnelIdSites()

  it("finds the funnel's callers", () => {
    expect(sites.length).toBeGreaterThan(30)
  })

  it("names an id in the job's family, or is listed with why", () => {
    const bad = sites.filter((s) => !inFamily(s.id) && !(s.key in ID_FROM_ELSEWHERE)).map((s) => `${s.key} (line ${s.line})`)
    expect(bad, "store under the job's id (`ctx.jobId`, `${ctx.jobId}-<label>`, rawExtensionObjectId / jobFileObjectId of it), or list it in ID_FROM_ELSEWHERE").toEqual([])
  })

  it("lists no id that no longer exists, and none the rule already admits", () => {
    const found = new Set(sites.map((s) => s.key))
    expect(Object.keys(ID_FROM_ELSEWHERE).filter((k) => !found.has(k))).toEqual([])
    expect(sites.filter((s) => s.key in ID_FROM_ELSEWHERE && inFamily(s.id)).map((s) => s.key)).toEqual([])
  })
})

