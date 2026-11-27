// @test-watches backend/src/**/*.ts
/**
 * CENSUS: every video input a step of ours reads goes through the source
 * resolver (decided 2026-11-22: "our own video steps use the kept original").
 *
 * A provider's file the browser-safe step would change is kept as the job's
 * original beside its 8-bit preview (lib/video-result-store.ts), and every
 * node is handed the preview. A step that downloads its input with a plain
 * `downloadFile` reads that preview: an editing step loses a generation it
 * need not, and an HDR input is not tone-mapped the way the preview is. So
 * every `downloadFile` call (and every ffmpeg launch that reads a link
 * itself) in `backend/src` is found, keyed `<file> :: <enclosing function>`,
 * and must be listed below with WHY it is not a video input of ours to
 * resolve. An editing step reads through `downloadEditingSource`, a step that
 * finishes a generation through `downloadVideoSource`
 * (providers/video/editing-source.ts); neither is a `downloadFile` site. A new
 * site fails this test until someone decides which it is; a listed site that
 * no longer exists fails it too.
 */
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { eachSourceFile, sourceFiles } from "../../../lib/__tests__/source-scan.js"
import { VIDEO_SOURCE_JOB_NAMES } from "../../../lib/video-source-context.js"

/** The reads this census takes: a download to a local file, and ffmpeg / ffprobe reading a link itself. */
const READERS = new Set(["downloadFile", "runFfmpegReadingLinks"])
/** The two doors (editing-source.ts). */
const DOORS = new Set(["downloadEditingSource", "downloadVideoSource", "tenBitJoinSource"])

const AUDIO = "reads only the sound: the preview carries the original's sound as AAC, the file every audio step was built and priced on"
const IMAGE = "an image (or a GIF), never a kept video original"
const MATTE = "a mask or depth matte: only its levels are read, and it is our own render, never a kept original"
const DELIVERED = "a provider's delivered file (or our own render of it) read as it is before it is stored: it is the original itself, kept by the store"
const PROVIDER_INPUT = "an input sent on to a provider's model as it is today (the preview); sending a provider the original is not decided"
const MEASURE = "a probe or measure of length or size, which the preview shares with its original"
const PRODUCT = "a product's own flow, out of scope here (decided 2026-11-22: products are not changed)"
const NOT_A_JOB = "not a job's output (a trend's catalog media)"
const ROUTE = "an API route's own read, not a worker step"
const STREAM_COPY = "stream-copies the picture it was given, so a copy of the conformed source would hand a user the working copy: reads its input as given, as before"

/**
 * Every door, keyed as the census keys reads, with how the step delivers what
 * it read: never at heavier or larger encode settings than it used on the
 * preview (the source is the preview's own class, `editing-source-length.test.ts`),
 * and never by copying the conformed picture.
 */
const FIXED_ENCODE = "re-encodes the picture at its own fixed settings, the same it used on the preview"
const DOOR_SITES: Readonly<Record<string, string>> = {
  "providers/video/add-captions.ts :: addCaptions": FIXED_ENCODE,
  "providers/video/assemble-narrated-video.ts :: assembleNarratedVideo": `${FIXED_ENCODE} (each block normalized at Combine's CRF 18, then joined by copy)`,
  "providers/video/combine-videos.ts :: combineVideos": `${FIXED_ENCODE} (every clip normalized at CRF 18 before any join, its fast path copying only those)`,
  "providers/video/edl-timeline.ts :: renderEdlTimeline": `${FIXED_ENCODE} (each chunk at its quality's settings, joined by copy)`,
  "providers/video/extract-frame.ts :: extractFrame": "writes one still image at its own settings",
  "providers/video/fade-video.ts :: fadeVideo": FIXED_ENCODE,
  "providers/video/loop-video.ts :: loopVideo": `${FIXED_ENCODE} (the duration mode at CRF 23, or the smart cut's CRF 20 before a repeat; a plain repeat reads as given)`,
  "providers/video/mask-composite.ts :: maskComposite": `${FIXED_ENCODE} (CRF 18; a server child's working copy only to its parent)`,
  "providers/video/mask-composite.ts :: maskCompositeFill": `${FIXED_ENCODE} (CRF 18; a server child's working copy only to its parent)`,
  "providers/video/merge-video-audio.ts :: mergeVideoAudioImpl": "Merge Video & Audio: copies the kept ORIGINAL's picture (decided 2026-11-22) and stores the result through the video result funnel, so the user gets that original beside its preview, never a working copy",
  "providers/video/resize-video.ts :: resizeVideo": FIXED_ENCODE,
  "providers/video/smart-loop-cut.ts :: smartLoopCut": `${FIXED_ENCODE} (a precise cut at CRF 20; a lossless cut reads as given)`,
  "providers/video/social-media-format.ts :: socialMediaFormat": FIXED_ENCODE,
  "providers/video/speed-ramp.ts :: speedRamp": FIXED_ENCODE,
  "providers/video/split-media.ts :: splitMedia": `${FIXED_ENCODE} (the whole picture once at CRF 23, then that encode cut into parts by copy)`,
  "providers/video/split-media.ts :: splitMediaAtShots": `${FIXED_ENCODE} (the whole picture once at CRF 23, then that encode cut into parts by copy)`,
  "providers/video/trim-video.ts :: trimVideo": `${FIXED_ENCODE} (a precise cut at its CRF; a keyframe cut reads as given)`,
  "providers/video/video-overlay-video-layers.ts :: fetchVideoOverlayVideoLayer": "a layer composited into Video Overlay's render, encoded at its own fixed settings",
  "providers/video/video-overlay.ts :: renderVideoOverlay": FIXED_ENCODE,
  "services/reference-sheet/motion-compositor.ts :: composeMotionSheet": `${FIXED_ENCODE} (the browser-safe settings)`,
  "workers/handlers/ffmpeg.ts :: handleTranscodeVideo": `${FIXED_ENCODE} (the codec and CRF the user chose, as before)`,
  "workers/handlers/mask-outline.ts :: handleMaskOutline": FIXED_ENCODE,
  "workers/handlers/video-ai.ts :: handleExtendVideo": "the Extend join: onto the kept original only when both clips are 10-bit (10-bit HEVC, kept as the original beside its preview, decided 2026-11-22); the tail and every 8-bit join read the preview, as before",
  "workers/handlers/video-face-mesh.ts :: handleVideoFaceMesh": `${FIXED_ENCODE} (a server child's working copy only to its parent)`,
  "workers/render-worker.ts :: normalizeInputVideos": "a Remotion render's input, re-encoded all-intra at fixed settings before the render encodes its own output",
}

/** Reads that are not a video input of ours to resolve, keyed `<file> :: <enclosing function>`, each with why. */
const NOT_A_SOURCE_READ: Readonly<Record<string, string>> = {
  // ── the doors themselves, the funnel, the primitives ──
  "providers/video/editing-source.ts :: download": "the doors' own download: the kept original the resolver found, or the url as given",
  "lib/video-result-store.ts :: storeAsPostProcessing": "the video result funnel's download of the file it stores (the provider's delivery)",
  "providers/video/ffmpeg-utils.ts :: readOwnStoredCopy": MEASURE,
  "providers/video/ffmpeg-reading-links.ts :: transcodeToBrowserSafeReadingLinks": "the plugin toolkit's link-reading transcode member (a path in, a path out)",
  "providers/video/ffmpeg-reading-links.ts :: remuxToMp4ReadingLinks": "the plugin toolkit's link-reading remux member (a path in, a path out)",
  // ── sound only ──
  "providers/video/assemble-narrated-video.ts :: assembleNarratedVideo": `${AUDIO} (each block's voice-over; its picture reads through downloadEditingSource)`,
  "providers/video/combine-audio.ts :: combineAudio": AUDIO,
  "providers/video/extract-audio.ts :: extractAudio": AUDIO,
  "providers/video/extract-audio-track.ts :: extractAudioTrack": AUDIO,
  "providers/video/trim-audio.ts :: trimAudio": AUDIO,
  "providers/video/mix-audio.ts :: mixAudio": AUDIO,
  "providers/video/audio-fx.ts :: applyAudioFx": AUDIO,
  "providers/video/split-media.ts :: splitMedia": `${AUDIO} (its audio input; its video reads through downloadEditingSource)`,
  "providers/video/edl-timeline.ts :: renderEdlTimeline": `${AUDIO} (an EDL's sound sources; its picture sources read through downloadEditingSource)`,
  "providers/video/adjust-volume.ts :: adjustVolume": STREAM_COPY,
  "providers/video/pitch-tempo.ts :: pitchTempo": STREAM_COPY,
  "providers/video/loop-video.ts :: loopVideo": `${STREAM_COPY} (a plain repeat)`,
  "providers/video/trim-video.ts :: trimVideo": `${STREAM_COPY} (a keyframe cut)`,
  "providers/video/merge-video-audio.ts :: mergeVideoAudioImpl": "the merge's sound tracks, and the picture of a caller that hands it the provider's own file (Lip Sync, Generate Video) or a product's; Merge Video & Audio reads its picture through downloadVideoSource",
  "providers/video/slideshow.ts :: downloadAll": IMAGE,
  "providers/video/slideshow.ts :: slideshow": `${AUDIO} (its soundtrack)`,
  "providers/video/still-to-video.ts :: stillToVideo": `${IMAGE} (and its soundtrack)`,
  "providers/audio/audio-sync.ts :: audioSync": `${AUDIO} (through the media proxy)`,
  "providers/audio/speaker-map.ts :: computeSpeakerMap": `${AUDIO} (through the media proxy)`,
  "providers/audio/silence-detect.ts :: detectSilence": `${AUDIO} (through the media proxy)`,
  "services/media-proxy.ts :: ensureMediaProxy": "the media proxy's source fetch for the sound analyses (silence, speakers, sync)",
  "services/media-proxy.ts :: ensureVideoProxy": `${MEASURE} (a low-resolution proxy an analysis reads: speakers, shots)`,
  "workers/handlers/heygen-avatar-audio-cap.ts :: capAudioForAvatar": AUDIO,
  "workers/handlers/face-swap-audio.ts :: swapWithSourceAudio": "Face Swap's sound restore: the swap result (the provider's) and the source's sound, stream-copied",
  "lib/audio-isolation-run.ts :: runAudioIsolation": AUDIO,
  "lib/lip-sync-inputs.ts :: downloadLipSyncAudio": AUDIO,
  "lib/audio-soundtrack.ts :: renderClip": `${AUDIO} (and a still frame)`,
  "workers/render-worker.ts :: renderSceneGraphViaFfmpeg": `${STREAM_COPY} (the scene graph's fast path, and its sound tracks)`,
  // ── images, masks ──
  "providers/image/collage.ts :: createImageCollage": IMAGE,
  "providers/image/overlay.ts :: createImageOverlay": IMAGE,
  "providers/video/video-overlay-images.ts :: fetchVideoOverlayImage": IMAGE,
  "nodes/gif-to-video/worker.ts :: worker": IMAGE,
  "providers/video/remove-audio.ts :: removeAudio": "Remove Audio stream-copies the file it is given, as before: a node unit, whose reading of an original would be a capability of its manifest (not decided)",
  "providers/video/mask-erase.ts :: eraseMaskVideo": MATTE,
  "providers/video/mask-composite.ts :: maskComposite": `${MATTE} (its pictures read through downloadEditingSource)`,
  "providers/video/mask-composite.ts :: maskCompositeFill": `${MATTE} (its pictures read through downloadEditingSource)`,
  "workers/handlers/mask-outline.ts :: handleMaskOutline": `${MATTE} (its picture reads through downloadEditingSource)`,
  "workers/handlers/video-face-mesh.ts :: handleVideoFaceMesh": `${MATTE} (its pictures read through downloadEditingSource)`,
  // ── a provider's delivered file, read before it is stored ──
  "providers/video/smart-loop-cut.ts :: smartLoopCut": `${DELIVERED} (Generate Video's own loop trim), and ${STREAM_COPY} (an editing node's lossless cut)`,
  "providers/video/grayscale-video.ts :: grayscaleVideo": DELIVERED,
  "workers/handlers/video-ai.ts :: stripAudioLocal": DELIVERED,
  "workers/handlers/video-ai.ts :: handleExtendVideo": `${DELIVERED} (the extension a model returned), and the source as the run named it (the tail sent to the model and every 8-bit join, as before; a 10-bit join reads the original through tenBitJoinSource)`,
  "workers/handlers/relay-render-home.ts :: bringRenderHome": DELIVERED,
  "lib/topaz-rhea-delivery.ts :: deliverRheaOutput": `${DELIVERED} (and the source's sound it is laid on)`,
  "lib/pro-delivery-store.ts :: storeProDeliveryClip": PRODUCT,
  // ── inputs a provider reads ──
  "providers/video/video-mask.ts :: prepareVideoMaskSource": PROVIDER_INPUT,
  "providers/elevenlabs/dubbing-project.ts :: downloadDubbingProject": DELIVERED,
  "providers/kie/reference-audio-convert.ts :: prepareReferenceAudio": `${AUDIO} (a provider's reference sound)`,
  "providers/kie/reference-video-reencode.ts :: reencodeReferenceVideo": PROVIDER_INPUT,
  "providers/kie/reference-video-size.ts :: ensureVideoFitsSize": PROVIDER_INPUT,
  "providers/kie/video.ts :: ensureAudioDuration": `${AUDIO} (a provider's input sound)`,
  "providers/kie/video.ts :: ensureVideoDuration": PROVIDER_INPUT,
  "providers/video/shot-cuts.ts :: measureShotCuts": `${MEASURE} (the shot boundaries of the picture)`,
  "workers/handlers/beeble-switchx.ts :: trimSwitchXSource": PROVIDER_INPUT,
  "workers/handlers/video-sfx-cap.ts :: capVideoSfxSource": PROVIDER_INPUT,
  "lib/gemini/media.ts :: fetchToPart": PROVIDER_INPUT,
  "lib/seedance-extend-mov-chain.ts :: cutChainedMovTail": PROVIDER_INPUT,
  "lib/large-upload-media.ts :: storedVideoPoster": `${MEASURE} (an upload's first frame)`,
  "lib/clip-measure.ts :: download": MEASURE,
  "utils/thumbnail.ts :: generateThumbnailFromUrl": "a thumbnail of the job's own playable result (the preview is what plays)",
  // ── products, catalog media, routes ──
  "providers/video/side-by-side.ts :: composeSideBySide": `${PRODUCT} (Video Remake's side by side, which tone-maps its own way)`,
  "lib/private-plugins/toolkit.ts :: rehostUpscaledVideo": PRODUCT,
  "lib/private-plugins/toolkit.ts :: extractTailToUrl": PRODUCT,
  "lib/private-plugins/toolkit.ts :: pluginDownloadFile": `${PRODUCT} (tk.ffmpeg.downloadFile, the plugins' own download)`,
  "workers/handlers/speaker-frames-relay.ts :: download": PRODUCT,
  "ee/pipelines/services/pipeline-extract-beat-grid.ts :: pipelineExtractBeatGrid": PRODUCT,
  "ee/pipelines/services/pipeline-final-merge.ts :: mergeScenesWithMusic": PRODUCT,
  "ee/lib/trends/media.ts :: fetchTo": NOT_A_JOB,
  "ee/lib/trends/preview-clip-media.ts :: fetchVideo": NOT_A_JOB,
  "ee/lib/trends/web-copy.ts :: makeWebCopy": NOT_A_JOB,
  "ee/scripts/backfill-trend-display.ts :: displayCopyOf": NOT_A_JOB,
  "routes/media-process.ts :: mediaProcessRoutes": ROUTE,
  "routes/video-scene-cuts.ts :: videoSceneCutsRoutes": ROUTE,
}

/**
 * The editing and finishing steps that must read through a door, keyed as the
 * census keys them: a revert to a plain download shows up here as well as above.
 */
const MUST_READ_THROUGH_A_DOOR = [
  "providers/video/combine-videos.ts",
  "providers/video/trim-video.ts",
  "providers/video/loop-video.ts",
  "providers/video/add-captions.ts",
  "providers/video/edl-timeline.ts",
  "providers/video/video-overlay.ts",
  "providers/video/extract-frame.ts",
  "providers/video/smart-loop-cut.ts",
  "providers/video/merge-video-audio.ts",
  "workers/render-worker.ts",
  "workers/handlers/ffmpeg.ts",
  "workers/handlers/video-ai.ts",
] as const

/**
 * Every video-worker job that reads its inputs as given, by why — the other
 * half of `VIDEO_SOURCE_JOB_NAMES`: together they hold every key of every
 * handler map the video worker runs, so a new handler decides which it is.
 */
const READS_AS_GIVEN: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["sound only: the preview carries the original's sound as AAC", [
    "trim-audio", "audio-fx", "mix-audio", "combine-audio", "extract-audio", "silence-detect", "audio-sync",
    "text-to-speech", "generate-music", "text-to-audio", "transcribe", "extract-youtube-audio", "audio-isolation",
    "audio-separation", "text-to-dialogue", "voice-remix", "voice-design", "forced-alignment", "speaker-map",
    "suno-generate", "suno-cover", "suno-extend", "suno-lyrics", "suno-separate", "suno-music-video", "suno-mashup",
    "suno-replace-section", "suno-add-instrumental", "suno-add-vocals", "suno-convert-wav", "suno-upload-extend", "suno-speech",
  ]],
  ["images (and GIFs), never a kept video original", [
    "image-collage", "image-overlay", "still-to-video", "slideshow", "gif-to-video", "generate-image", "edit-image",
    "image-to-image", "reference-board", "split-into-layers", "long-image",
  ]],
  ["a provider's generation: what it sends a model is as today, and its delivery is kept as the original by the store", [
    "image-to-video", "voiced-video", "text-to-video", "speech-to-video", "ai-avatar", "cinematic-avatar",
    "generate-character", "generate-face", "generate-character-asset", "generate-object", "generate-object-asset",
    "generate-creature", "generate-creature-asset", "generate-location", "generate-location-asset", "generate-script",
    "generate-character-motion", "generate-location-motion", "generate-object-motion", "generate-creature-motion",
    "generate-3d-scene", "edit-3d-scene", "generate-surround-continuation", "motion-graphics-lottie", "llm-structured",
  ]],
  ["hands its video on to a provider's model as it is today; sending a provider the original is not decided", [
    "video-to-video", "lip-sync", "motion-transfer", "video-upscale", "video-retake", "face-swap", "generate-mask",
    "switchx", "video-sfx", "video-mask", "mask-erase", "video-depth", "voice-changer", "dubbing",
  ]],
  ["an analysis of the picture (its shot boundaries), which the preview shares", ["shot-cuts"]],
  ["stream-copies the picture it is given (its video lane): a copy of the conformed source would hand a user the working copy", ["adjust-volume", "pitch-tempo"]],
  ["Remove Audio stream-copies the file it is given; a node unit, whose reading of an original would be a capability of its manifest (not decided)", ["remove-audio"]],
]

/** The string keys of every handler map the video worker composes (`*Handlers`, `createSurroundHandlers`, `UNIT_WORKERS`). */
function handlerKeys(): string[] {
  const keys: string[] = []
  const take = (o: ts.ObjectLiteralExpression) => {
    for (const p of o.properties) {
      if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && (ts.isStringLiteral(p.name) || ts.isIdentifier(p.name))) keys.push(p.name.text)
    }
  }
  const mapOf = (init: ts.Expression | undefined) => {
    if (!init) return
    if (ts.isObjectLiteralExpression(init)) take(init)
    else if (ts.isCallExpression(init)) for (const a of init.arguments) if (ts.isObjectLiteralExpression(a)) take(a)
  }
  eachSourceFile(["Handlers", "UNIT_WORKERS"], (sf, rel) => {
    if (!/^workers\/handlers\/[^/]+\.ts$/.test(rel) && rel !== "nodes/_generated/workers.ts") return
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && (/Handlers$/.test(n.name.text) || n.name.text === "UNIT_WORKERS")) mapOf(n.initializer)
      if (ts.isFunctionDeclaration(n) && n.name && /Handlers$/.test(n.name.text)) {
        const inner = (m: ts.Node): void => {
          if (ts.isReturnStatement(m) && m.expression && ts.isObjectLiteralExpression(m.expression)) take(m.expression)
          if (!ts.isFunctionLike(m) || m === n) m.forEachChild(inner)
        }
        n.forEachChild(inner)
      }
      n.forEachChild(visit)
    }
    visit(sf)
  })
  return [...new Set(keys)]
}

interface Site { key: string; line: number }

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

/** Every call of `names`, keyed `<file> :: <enclosing function>` (declarations of the names themselves left out). */
function callSites(names: ReadonlySet<string>): Site[] {
  const sites: Site[] = []
  eachSourceFile([...names], (sf, rel) => {
    if (rel.startsWith("scripts/") || rel.includes("__characterization__")) return
    const visit = (n: ts.Node, fn: string): void => {
      const here = nameOf(n, sf) ?? fn
      if (ts.isCallExpression(n)) {
        const name = calleeName(n)
        if (name && names.has(name)) sites.push({ key: `${rel} :: ${here}`, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
      }
      n.forEachChild((c) => visit(c, here))
    }
    visit(sf, "<module>")
  })
  // A reader's own definition (`downloadFile` calling its helpers) is not a read of an input.
  return sites.filter((s) => !/^providers\/video\/ffmpeg-utils\.ts :: downloadFile$/.test(s.key) && !/^providers\/video\/ffmpeg-process\.ts/.test(s.key))
}

describe("every video input a step of ours reads goes through the source resolver", () => {
  const reads = callSites(READERS)
  const doors = callSites(DOORS)

  it("finds no plain read that is not listed with why", () => {
    const unlisted = reads.filter((s) => !(s.key in NOT_A_SOURCE_READ)).map((s) => `${s.key} (line ${s.line})`)
    expect(unlisted, "read a video input through downloadEditingSource / downloadVideoSource (providers/video/editing-source.ts), or list the site in NOT_A_SOURCE_READ with why").toEqual([])
  })

  it("lists no site that no longer exists", () => {
    const found = new Set(reads.map((s) => s.key))
    expect(Object.keys(NOT_A_SOURCE_READ).filter((k) => !found.has(k))).toEqual([])
  })

  it("gives every listed site a reason", () => {
    for (const [key, why] of Object.entries(NOT_A_SOURCE_READ)) expect(why.length, key).toBeGreaterThan(20)
  })

  it("every job named as reading originals is a registered handler: a handler key, or a node unit's worker", () => {
    const text = sourceFiles().filter((f) => /\/workers\/handlers\/[^/]+\.ts$/.test(f)).map((f) => readFileSync(f, "utf8")).join("\n")
    const units = new Set(sourceFiles().filter((f) => /\/nodes\/[^/_][^/]*\/worker\.ts$/.test(f)).map((f) => f.split("/").at(-2)))
    const unknown = [...VIDEO_SOURCE_JOB_NAMES].filter((name) => !text.includes(`"${name}": handle`) && !units.has(name))
    expect(unknown).toEqual([])
  })

  it("every video-worker job either reads originals or is listed with why it reads as given", () => {
    const asGiven = new Map(READS_AS_GIVEN.flatMap(([why, names]) => names.map((n) => [n, why] as const)))
    const keys = handlerKeys()
    expect(keys.length).toBeGreaterThan(80)
    expect(keys.filter((k) => !VIDEO_SOURCE_JOB_NAMES.has(k) && !asGiven.has(k))).toEqual([])
    expect([...asGiven.keys()].filter((k) => VIDEO_SOURCE_JOB_NAMES.has(k))).toEqual([])
    expect([...asGiven.keys()].filter((k) => !keys.includes(k))).toEqual([])
  })

  it("every door is listed with how its step delivers what it read", () => {
    const found = [...new Set(doors.map((s) => s.key))].sort()
    expect(found.filter((k) => !(k in DOOR_SITES))).toEqual([])
    expect(Object.keys(DOOR_SITES).filter((k) => !found.includes(k))).toEqual([])
  })

  it("no step that reads a door matches its encode to the input's bitrate (the conformed source's is the working copy's, not the preview's)", () => {
    const files = [...new Set(doors.map((s) => s.key.split(" :: ")[0]!))]
    const matched = files.filter((f) => /\bmatchedPictureArgs\b|\bvideoBitRate\b/.test(readFileSync(sourceFiles().find((p) => p.endsWith(`/src/${f}`))!, "utf8")))
    expect(matched).toEqual([])
  })

  it("the editing and finishing steps read through a door", () => {
    const files = new Set(doors.map((s) => s.key.split(" :: ")[0]))
    expect(MUST_READ_THROUGH_A_DOOR.filter((f) => !files.has(f))).toEqual([])
  })
})
