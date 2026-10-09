/**
 * CENSUS: every file a job writes is one the expiry walk can find
 * (decided 2026-10-08).
 *
 * The retention reapers (`ee/billing/cleanup-service.ts`) and the admin app
 * expunge (`lib/collect-app-r2-keys.ts`) read a job's files off its WHOLE
 * `output_data` through `lib/job-output-keys.ts`: every string at any depth
 * that is one of our urls, kept when its key is in the job's own key family
 * (`isOwnedObjectKey`: `<prefix>/<jobId>` or `<prefix>/<jobId>-<suffix>`).
 *
 * The walk reaches every SHAPE by construction, so what can still leave a
 * file behind is the KEY a writer picks: one outside the job's family is
 * refused by the fence and outlives its job. So the census is taken over the
 * writers themselves, derived from the code: every call to one of the storage
 * writers or copy helpers in `backend/src` is found and its key argument read,
 * and so is every raw `PutObjectCommand` / `CopyObjectCommand` sent outside
 * `lib/storage.ts` (its `Key:`).
 *
 *   - A key built from the running job's id (`jobId`, `ctx.jobId`,
 *     `opts.jobId`, `job.id`, `${jobId}-…`, `<prefix>/${jobId}.…`,
 *     `variantJobId(jobId, i)`, `mediaObjectKey(jobId, …)`) is in the family:
 *     the census builds the key it makes, nests its url deep in an output, and
 *     asserts the walk returns it.
 *   - A temporary provider upload (a copy of the user's media made only so a
 *     provider can fetch it) goes through the job-scratch writers
 *     (`lib/job-scratch.ts`, decided 2026-10-09): its key is in the job's
 *     scratch folder, which is emptied when the job ends. It is never listed
 *     below as an exception: a staging copy with a key of its own would
 *     outlive its job.
 *   - Any other key must be listed below with WHY — not a job's output (an
 *     upload, a cache). A new writer whose key
 *     is neither fails this test until someone decides which it is. Where one
 *     key expression serves calls with different answers, each call is listed
 *     by the variable it assigns (`<file> :: <key> → <variable>`).
 *
 * What this cannot see: the shapes and keys the private cloud plugins write.
 * They reach storage through the plugin toolkit (`lib/private-plugins/`),
 * whose writers take a key from the plugin (`copyRecastObject` among them, a
 * copy to a key the plugin picks); the plugin-written shapes the app knows of
 * are pinned as fixtures at the bottom.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("../config.js", () => ({ config: { R2_PUBLIC_URL: "https://cdn.test" } }))
// The family rule's module imports the storage client, which this pure walk never calls.
vi.mock("../storage.js", () => ({ r2KeyFromOurUrl: () => null }))

import { variantJobId } from "@nodaro/shared"
import {
  inpaintCompositeKey,
  jobFileObjectId,
  ownedJobOutputFiles,
  rawExtensionObjectId,
  rawExtensionReferenceObjectId,
  silentVideoKey,
} from "../job-output-keys.js"
import { applyEdlOutputData } from "../apply-edl-output.js"
import { JOB_SCRATCH_ROOT, jobScratchKey, jobScratchPrefix } from "../job-scratch-keys.js"
import { parseText, sourceFiles as shippedSourceFiles, relPath } from "./source-scan.js"
import ts from "typescript"

const BACKEND_SRC = join(__dirname, "..", "..")
const JOB = "00000000-0000-4000-8000-0000000000aa"
const OTHER = "00000000-0000-4000-8000-0000000000bb"
const url = (key: string) => `https://cdn.test/${key}`

/** The storage writers and copy helpers (lib/storage.ts); each takes its key
 *  (or what the key is built from) as the second argument. */
const WRITERS = [
  "uploadToR2",
  "uploadBufferToR2",
  "uploadFileToR2",
  "uploadLocalFileToR2Key",
  "uploadFileWithKeyToR2",
  "copyRecastObject",
  "copyToTemplatePreview",
  "copyR2ObjectToPrefix",
] as const
/** Writers whose key is derived from an argument that is never a job's id
 *  (`templatePreviewKey(templateId, …)`): never in a job's family. */
const NEVER_IN_FAMILY: ReadonlySet<string> = new Set(["copyToTemplatePreview"])
/** Raw S3 commands that write an object, sent past the writers above. */
const RAW_SENDS = ["PutObjectCommand", "CopyObjectCommand", "CreateMultipartUploadCommand", "Upload"] as const
/** Writers whose second argument is an object ID — the key is
 *  `mediaObjectKey(id, type)` = `<type>s/<id>.<ext>` — rather than a key. */
const ID_ARG_WRITERS: ReadonlySet<string> = new Set(["uploadToR2", "uploadFileToR2"])

/** Files the scan skips, with why. */
const NOT_SCANNED: Readonly<Record<string, string>> = {
  "lib/storage.ts": "defines the writers",
  "lib/private-plugins/types.ts": "the plugin toolkit's interface: signatures, not calls (the plugins' keys are not visible here)",
}
/** Operator scripts are not jobs. */
const isScript = (file: string) => file.startsWith("scripts/")

const UPLOAD = "a user's upload or import: its `assets` row owns the object (the assets phase reaps it), not a job output"
const CACHE = "a content-addressed cache any job may read; never one job's to delete"
const NOT_A_JOB = "not written for a job: the key carries no job id and the object is not a job output"

/**
 * Writer calls whose key is NOT in the running job's family, keyed
 * `<file> :: <key argument>`. Each says why that is right.
 */
const OUTSIDE_A_JOB_FAMILY: Readonly<Record<string, string>> = {
  "ee/pipelines/_freecut-timeline.ts :: r2Key": `${UPLOAD} (a pipeline export filed as an asset)`,
  "ee/pipelines/services/pipeline-extract-beat-grid.ts :: r2Key": `${UPLOAD} (the trimmed pipeline music asset)`,
  "lib/character-lora.ts :: key": `${NOT_A_JOB} (a character's LoRA training zip)`,
  "lib/media-import.ts :: r2Key": UPLOAD,
  "lib/media-import.ts :: thumbKey": UPLOAD,
  "lib/media-portability.ts :: r2Key": UPLOAD,
  "lib/media-url-import.ts :: key": UPLOAD,
  "lib/scraped-media.ts :: outputId": `${UPLOAD} (scraped media)`,
  "lib/video-download.ts :: thumbR2Key": `${NOT_A_JOB} (a downloaded source video's poster)`,
  "lib/video-download.ts :: videoR2Key": `${NOT_A_JOB} (a downloaded source video)`,
  "lib/video-download.ts :: `thumbnails/yt-${outputId}.png`": `${NOT_A_JOB} (a downloaded source video's poster)`,
  "lib/video-frame-fit.ts :: key": `${CACHE} (frame-fit, by source url + plan)`,
  "providers/audio/youtube-extractor.ts :: `yt-extract-${outputId}`": `${NOT_A_JOB} (extracted source audio)`,
  "providers/video/edl-timeline.ts :: key": "the render's own resumable chunk checkpoints, deleted by the render itself",
  "routes/media-process.ts :: r2Key": UPLOAD,
  "routes/media-process.ts :: thumbKey": UPLOAD,
  "routes/split-image.ts :: key": `${NOT_A_JOB} (a character sheet split into images)`,
  "routes/telegram-webhook.ts :: `${keyPrefix}-photo.jpg`": `${NOT_A_JOB} (an incoming Telegram message's media)`,
  "routes/telegram-webhook.ts :: `${keyPrefix}-video.mp4`": `${NOT_A_JOB} (an incoming Telegram message's media)`,
  "routes/telegram-webhook.ts :: `${keyPrefix}-audio.ogg`": `${NOT_A_JOB} (an incoming Telegram message's media)`,
  "routes/youtube-audio.ts :: `audios/yt-${outputId}.mp3`": `${NOT_A_JOB} (downloaded source audio)`,
  "routes/youtube-audio.ts :: thumbR2Key": `${NOT_A_JOB} (downloaded source audio's poster)`,
  "services/media-proxy.ts :: key": `${CACHE} (an analysis proxy, by source url + settings)`,
  "services/media-proxy.ts :: manifestKey": `${CACHE} (the proxy's manifest)`,
  "workers/handlers/ffmpeg.ts :: cacheKey": `${CACHE} (GIF → MP4, by content hash)`,
  "workers/shared.ts :: `audios/cover-src-${outputId}.mp3`":
    `${NOT_A_JOB} (a workflow run's link audio, fetched by the run before any of its jobs and read by its later nodes)`,
  // The copy helpers.
  "ee/services/community/asset-lifecycle.ts :: prefix": `${NOT_A_JOB} (a community listing's copy of an entity's assets, under \`community/<listingId>/\`)`,
  "ee/services/community/clone.ts :: destPrefix": `${NOT_A_JOB} (a user's clone of a community entity, under \`user-clones/<userId>/\`)`,
  "routes/workflow-templates.ts :: existingTemplate.id": `${NOT_A_JOB} (a template's durable preview, keyed by the template)`,
  "routes/workflow-templates.ts :: newTemplateId": `${NOT_A_JOB} (a template's durable preview, keyed by the template)`,
  // Raw sends past the writers.
  "lib/retained-images.ts :: key": `${NOT_A_JOB} (a retained image, \`retainedImageKey(row.id)\`: its own row owns and reaps it)`,
  "lib/retained-videos.ts :: key": `${NOT_A_JOB} (a retained video, \`retainedVideoKey(row.id)\`: its own row owns and reaps it)`,
  "lib/private-plugins/scene3d-upload-grants.ts :: key":
    `${NOT_A_JOB} (a presigned PUT into the private scene bucket, keyed by user + revision, with its own reservation record)`,
  "routes/upload.ts :: key": UPLOAD,
  "routes/upload-proxy.ts :: payload.key": UPLOAD,
  "routes/upload-handoff.ts :: payload.key": UPLOAD,
}

/**
 * Writer calls whose key is in the running job's SCRATCH folder
 * (`jobScratchKey`), which `discardJobScratch` empties when the job ends
 * (decided 2026-10-09). Only the job-scratch writers themselves are here;
 * every temporary provider upload calls them.
 */
const CLEANED_AT_JOB_END: Readonly<Record<string, string>> = {
  "lib/job-scratch.ts :: key": "the job-scratch writers: `key` is `jobScratchKey(jobId, …)`, in the folder the job's end empties",
}

/**
 * Every call to the job-scratch writers (or `jobScratchKey`) outside the
 * scratch module, by `<file> :: <file name>`, with the job whose end empties
 * its folder (independent review of the scratch folder, decided 2026-10-09).
 *
 * The writers default to the RUNNING job (`getJobId()`), and with no job id
 * the key falls back to the flat `tmp/provider-input/<name>-<nonce>.<ext>`
 * that no job's end reaches. So a call is cleaned at the job's end only when
 * it runs inside the video worker's job context (`runWithJobCancellation`,
 * where `discardJobScratch` sits in the `finally`) or hands the writer that
 * job's id. A new call site fails this census until someone checks which.
 */
const SCRATCH_CALL_SITES: Readonly<Record<string, string>> = {
  "providers/kie/image.ts :: \"resized-mask\"": "Ideogram edit's resized mask: the KIE image provider runs only inside a video-worker job (the running job's id)",
  "providers/kie/video.ts :: \"lip-sync-trimmed\"": "KIE lip-sync's trimmed audio: the KIE video provider runs only inside a video-worker job (the running job's id)",
  "providers/kie/video.ts :: \"motion-trimmed\"": "KIE motion control's trimmed video: inside a video-worker job (the running job's id)",
  "providers/kie/video.ts :: \"provider-converted\"": "KIE's format-converted input frames (both conversions): inside a video-worker job (the running job's id)",
  "workers/handlers/heygen-avatar-audio-cap.ts :: \"ai-avatar-audio-cap\"": "HeyGen's capped audio: `jobId` is the avatar handler's `ctx.jobId`",
  "workers/handlers/video-ai.ts :: \"extend-tail\"": "a Seedance extend's source tail: `ctx.jobId`",
  "workers/handlers/video-ai.ts :: \"extend-last-frame\"": "a Seedance extend's last frame: `ctx.jobId`",
  "workers/shared.ts :: \"cover-src\"": "Suno's re-hosted source audio: `opts.scratchJobId` is the Suno handler's `ctx.jobId` (without one the flat `audios/` key is listed above)",
}

/** The scratch writers' callers outside the scratch module, as `<file> :: <file name>`. */
function scratchCallSites(): string[] {
  const re = /\b(uploadJobScratchBuffer|uploadJobScratchFile|jobScratchKey)\(/g
  const sites: string[] = []
  for (const path of sourceFiles(BACKEND_SRC)) {
    const file = relative(BACKEND_SRC, path).split("\\").join("/")
    if (file === "lib/job-scratch.ts" || file === "lib/job-scratch-keys.ts" || isScript(file)) continue
    const src = readFileSync(path, "utf8")
    for (const m of src.matchAll(re)) {
      if (/function\s+$/.test(src.slice(Math.max(0, m.index! - 20), m.index!))) continue
      sites.push(`${file} :: ${squash(callArgs(src, m.index! + m[0].length - 1)[1] ?? "")}`)
    }
  }
  return sites
}

/**
 * Writer calls whose key IS in the job's family but is built where the scan
 * cannot read it (a variable, another row's id). Each gives the key it makes,
 * so the walk is still checked against it.
 */
const IN_FAMILY_BUILT_ELSEWHERE: Readonly<Record<string, { key: (jobId: string) => string; why: string }>> = {
  "lib/reconcile/kie.ts :: variantJobId(row.id, i)": {
    key: (j) => `audios/${variantJobId(j, 1)}.mp3`,
    why: "`row` is the jobs row being reconciled: its variants are `<jobId>-v<i>`",
  },
  // Each entry runs the writer's REAL builder (independent review round: two
  // used to restate the key by hand, so a writer could drift out of the family
  // with this census still green).
  "services/inpaint/composite.ts :: inpaintCompositeKey(opts.jobId)": {
    key: (j) => inpaintCompositeKey(j),
    why: "an inpaint job's composite, `inpaint/<jobId>.png`: the job's own slot",
  },
  "workers/handlers/video-ai.ts :: silentVideoKey(jobId)": {
    key: (j) => silentVideoKey(j),
    why: "Veo's audio-stripped copy, `videos/<jobId>-silent.mp4`: the job's family",
  },
  // Decided 2026-10-08: these four were known gaps (random keys) and now key
  // in the job's family. Each entry runs the writer's REAL builder.
  "workers/handlers/video-ai.ts :: rawExtensionObjectId(ctx.jobId)": {
    key: (j) => `videos/${rawExtensionObjectId(j)}.mov`,
    why: "a Seedance extend's raw .mov copy, `<jobId>-raw`: the job's family, never the deliverable's slot",
  },
  "workers/handlers/video-ai.ts :: rawExtensionReferenceObjectId(ctx.jobId)": {
    key: (j) => `videos/${rawExtensionReferenceObjectId(j)}.mov`,
    why: "a later extend's own copy of the clip it continues from, `<jobId>-raw-ref` (decided 2026-10-08, round 12): named in its output, so its expiry deletes it",
  },
  "lib/private-plugins/toolkit.ts :: jobFileObjectId(getJobId(), \"combine\")": {
    key: (j) => `videos/${jobFileObjectId(j, "combine")}.mp4`,
    why: "the toolkit's combine-videos result, keyed by the RUNNING job (`getJobId()`, the job whose handler called the toolkit); outside a job no job owns it and the id is random",
  },
  "lib/private-plugins/toolkit.ts :: `images/${jobFileObjectId(getJobId(), \"plate\")}.${ext}`": {
    key: (j) => `images/${jobFileObjectId(j, "plate")}.png`,
    why: "the toolkit's upscaled plate, keyed by the running job like the combine result",
  },
  "workers/scene3d-render-child.ts :: jobFileObjectId(child.id, \"render\")": {
    key: (j) => `videos/${jobFileObjectId(j, "render")}.mp4`,
    why: "Pro 3D Render's delivered video: `child` is the render's own jobs row, and the nonce keeps the key unguessable",
  },
}

const JOB_ID = String.raw`(?:ctx\.|opts\.)?jobId|job\.id`
/** An object id in the job's family. */
const FAMILY_ID = new RegExp(String.raw`^(?:(?:${JOB_ID})|\x60\$\{(?:${JOB_ID})\}-[^\x60/]*\x60|variantJobId\((?:${JOB_ID}), \w+\))$`)
/** A whole key whose last segment starts with the job id, then `-` or `.`. */
const FAMILY_KEY = new RegExp(String.raw`^\x60(?:[\w.-]+/)*\$\{(?:${JOB_ID})\}(?:[-.][^\x60/]*)?\x60$`)
const MEDIA_OBJECT_KEY = /^mediaObjectKey\((.+?), [^)]*\)$/

/** The key an in-family argument makes for job `jobId` (prefix-agnostic: the
 *  family rule reads the stem). */
function keyMadeBy(writer: string, arg: string, jobId: string): string {
  const sub = (s: string) =>
    s
      .replace(/^\x60|\x60$/g, "")
      .replace(new RegExp(String.raw`\$\{(?:${JOB_ID})\}`, "g"), jobId)
      .replace(/\$\{[^}]*\}/g, "x")
  const media = MEDIA_OBJECT_KEY.exec(arg)
  const id = media ? media[1]! : ID_ARG_WRITERS.has(writer) ? arg : null
  if (id === null) return sub(arg)
  const variant = new RegExp(String.raw`^variantJobId\((?:${JOB_ID}), \w+\)$`).test(id)
  const stem = variant ? variantJobId(jobId, 1) : new RegExp(`^(?:${JOB_ID})$`).test(id) ? jobId : sub(id)
  return `media/${stem}.bin`
}

function isInFamily(writer: string, arg: string): boolean {
  if (NEVER_IN_FAMILY.has(writer)) return false
  const media = MEDIA_OBJECT_KEY.exec(arg)
  if (media) return FAMILY_ID.test(media[1]!)
  return ID_ARG_WRITERS.has(writer) ? FAMILY_ID.test(arg) : FAMILY_KEY.test(arg)
}

/** The top-level arguments of the call whose `(` is at `open`. */
function callArgs(src: string, open: number): string[] {
  const out: string[] = []
  const stack: string[] = []
  let cur = ""
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]!
    const top = stack[stack.length - 1]
    if (top === "'" || top === '"') {
      cur += c
      if (c === "\\") cur += src[++i] ?? ""
      else if (c === top) stack.pop()
      continue
    }
    if (top === "`") {
      cur += c
      if (c === "\\") cur += src[++i] ?? ""
      else if (c === "`") stack.pop()
      else if (c === "$" && src[i + 1] === "{") {
        cur += "{"
        i++
        stack.push("${")
      }
      continue
    }
    if (c === "'" || c === '"' || c === "`" || c === "(" || c === "[" || c === "{") {
      stack.push(c)
      cur += c
      continue
    }
    if (c === ")" || c === "]" || c === "}") {
      if (stack.length === 0) {
        out.push(cur)
        return out
      }
      stack.pop()
      cur += c
      continue
    }
    if (c === "," && stack.length === 0) {
      out.push(cur)
      cur = ""
      continue
    }
    cur += c
  }
  return out
}

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(path))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) {
      out.push(path)
    }
  }
  return out
}

interface WriterCall {
  readonly file: string
  readonly writer: string
  readonly arg: string
  /** `<file> :: <key>` */
  readonly signature: string
  /** `<file> :: <key> → <variable>`, when the call's result is assigned. */
  readonly assigned: string | null
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim()

function call(file: string, writer: string, arg: string, before: string): WriterCall {
  const target = /(\w+)\s*=\s*(?:await\s+)?$/.exec(before)?.[1] ?? null
  const signature = `${file} :: ${arg}`
  return { file, writer, arg, signature, assigned: target ? `${signature} → ${target}` : null }
}

function writerCalls(): WriterCall[] {
  const re = new RegExp(String.raw`\b(${WRITERS.join("|")})\(`, "g")
  const raw = new RegExp(String.raw`\bnew (${RAW_SENDS.join("|")})\(`, "g")
  const calls: WriterCall[] = []
  for (const path of sourceFiles(BACKEND_SRC)) {
    const file = relative(BACKEND_SRC, path).split("\\").join("/")
    if (file in NOT_SCANNED || isScript(file)) continue
    const src = readFileSync(path, "utf8")
    const before = (i: number) => src.slice(Math.max(0, i - 80), i)
    for (const m of src.matchAll(re)) {
      if (/function\s+$/.test(before(m.index!))) continue
      const arg = squash(callArgs(src, m.index! + m[0].length - 1)[1] ?? "")
      calls.push(call(file, m[1]!, arg, before(m.index!)))
    }
    if (file === "lib/storage.ts") continue
    for (const m of src.matchAll(raw)) {
      const params = callArgs(src, m.index! + m[0].length - 1).join(",")
      // An unreadable `Key:` is listed as such, so it fails rather than hides.
      const key = /\bKey:\s*([^,}\n]+)/.exec(params)?.[1]
      calls.push(call(file, m[1]!, key ? squash(key) : `<${m[1]} with no readable Key>`, before(m.index!)))
    }
  }
  return calls
}

const CALLS = writerCalls()

/** The entry a call is listed under: by its assigned variable first, else by its key. */
function listed(c: WriterCall): string | null {
  for (const s of [c.assigned, c.signature]) {
    if (s && (s in OUTSIDE_A_JOB_FAMILY || s in IN_FAMILY_BUILT_ELSEWHERE || s in CLEANED_AT_JOB_END)) return s
  }
  return null
}

describe("the storage writers, as the code has them", () => {
  it("finds the writers (the census is not empty)", () => {
    expect(CALLS.length).toBeGreaterThan(50)
    expect(CALLS.some((c) => c.file === "workers/shared.ts")).toBe(true)
    // ...the copy helpers and the raw sends past the writers too.
    expect(CALLS.some((c) => c.writer === "copyR2ObjectToPrefix")).toBe(true)
    expect(CALLS.some((c) => c.writer === "PutObjectCommand" && c.file === "lib/retained-images.ts")).toBe(true)
  })

  it("every writer's key is in the running job's family, or is listed with why", () => {
    const unexplained = CALLS.filter((c) => !isInFamily(c.writer, c.arg) && listed(c) === null).map(
      (c) => `${c.assigned ?? c.signature}   (${c.writer})`,
    )
    // A new entry here: a writer the expiry walk cannot tie to its job. Key it
    // `<prefix>/<jobId>` or `<jobId>-<suffix>`, or list it above with why.
    expect(unexplained).toEqual([])
  })

  it("every listed entry still names a writer call (a stale entry would excuse a new one)", () => {
    const seen = new Set(CALLS.map(listed))
    const stale = [
      ...Object.keys(OUTSIDE_A_JOB_FAMILY),
      ...Object.keys(IN_FAMILY_BUILT_ELSEWHERE),
      ...Object.keys(CLEANED_AT_JOB_END),
    ].filter((s) => !seen.has(s))
    expect(stale).toEqual([])
    // ...and lists no call the rule already admits.
    const redundant = CALLS.filter((c) => isInFamily(c.writer, c.arg) && listed(c) !== null)
    expect(redundant.map((c) => c.signature)).toEqual([])
  })

  it("every skipped file still exists", () => {
    const files = new Set(sourceFiles(BACKEND_SRC).map((p) => relative(BACKEND_SRC, p).split("\\").join("/")))
    expect(Object.keys(NOT_SCANNED).filter((f) => !files.has(f))).toEqual([])
  })

  it("the walk returns every in-family writer's file, wherever the output holds it", () => {
    const missed: string[] = []
    for (const c of CALLS) {
      const entry = listed(c)
      const built = entry === null ? undefined : IN_FAMILY_BUILT_ELSEWHERE[entry]
      if (!built && !isInFamily(c.writer, c.arg)) continue
      const key = built ? built.key(JOB) : keyMadeBy(c.writer, c.arg, JOB)
      for (const output of placements(url(key))) {
        const { files, heldBack } = ownedJobOutputFiles(JOB, output)
        if (!files.some((f) => f.key === key) || heldBack !== 0) missed.push(`${c.signature} → ${key}`)
      }
    }
    expect(missed).toEqual([])
  })
})

describe("temporary provider uploads (decided 2026-10-09)", () => {
  it("the scratch writers key every file in the job's scratch folder, which the job's end empties", () => {
    const src = readFileSync(join(BACKEND_SRC, "lib", "job-scratch.ts"), "utf8")
    // Both writers take the key `jobScratchKey` built, and nothing else.
    expect(src).toMatch(/const key = jobScratchKey\(/)
    const writes = CALLS.filter((c) => c.file === "lib/job-scratch.ts")
    expect(writes.map((c) => c.writer).sort()).toEqual(["uploadBufferToR2", "uploadFileWithKeyToR2"])
    expect(writes.every((c) => c.arg === "key")).toBe(true)
    // The key is in the folder `discardJobScratch` lists and deletes.
    expect(jobScratchKey(JOB, "mask", "png").startsWith(jobScratchPrefix(JOB))).toBe(true)
    expect(jobScratchPrefix(JOB).startsWith(JOB_SCRATCH_ROOT)).toBe(true)
  })

  it("every scratch write runs inside a job the video worker ends, or names its job (a flat fallback key outlives every job)", () => {
    const sites = scratchCallSites()
    expect(sites.length).toBeGreaterThan(0)
    // A new entry here: a temporary provider upload whose job context nobody
    // checked. Outside a job its key is the flat one nothing deletes.
    expect([...new Set(sites)].filter((s) => !(s in SCRATCH_CALL_SITES))).toEqual([])
    // ...and no entry outlives its call (a stale one would excuse a new one).
    expect(Object.keys(SCRATCH_CALL_SITES).filter((s) => !sites.includes(s))).toEqual([])
  })

  it("only the video worker opens a job context, and it empties the scratch folder when the job ends", () => {
    const opened: string[] = []
    for (const path of sourceFiles(BACKEND_SRC)) {
      const file = relative(BACKEND_SRC, path).split("\\").join("/")
      if (file === "lib/job-cancellation.ts") continue
      if (/\brunWithJobCancellation\(/.test(readFileSync(path, "utf8"))) opened.push(file)
    }
    // Another worker running handlers in a job context would write scratch
    // that only the video worker's `finally` empties: wire `discardJobScratch`
    // there before adding it here.
    expect(opened).toEqual(["workers/video-worker.ts"])
    expect(readFileSync(join(BACKEND_SRC, "workers", "video-worker.ts"), "utf8")).toMatch(/\bdiscardJobScratch\(/)
  })

  it("no exception above excuses a staging copy: one must go through the scratch writers", () => {
    const staging = /stag(?:e|ing)\b|provider[- ]input|scratch|throwaway|temporar/i
    expect(Object.entries(OUTSIDE_A_JOB_FAMILY).filter(([, why]) => staging.test(why)).map(([k]) => k)).toEqual([])
  })

  it("only the scratch module spells the scratch root (a flat temp key next to it would outlive its job)", () => {
    const spelled: string[] = []
    for (const file of shippedSourceFiles()) {
      const text = readFileSync(file, "utf8")
      if (!text.includes("provider-input")) continue
      const visit = (n: ts.Node): void => {
        if ((ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && n.text.includes("provider-input")) {
          spelled.push(relPath(file))
        }
        ts.forEachChild(n, visit)
      }
      visit(parseText(file, text))
    }
    expect([...new Set(spelled)]).toEqual(["lib/job-scratch-keys.ts"])
  })
})

/** One url, held at the top level, nested, in a list, and in a list of objects. */
function placements(u: string): Array<Record<string, unknown>> {
  return [
    { videoUrl: u },
    { json: { url: u } },
    { imageUrls: [u] },
    { result: { variants: [{ deep: [{ url: u }] }] } },
  ]
}

describe("the output shapes the app knows of", () => {
  it("Apply EDL's output (its real builder): the cut and its poster", () => {
    const output = applyEdlOutputData({
      medium: "video",
      mediaUrl: url(`videos/${JOB}.mp4`),
      thumbnailUrl: url(`thumbnails/${JOB}.png`),
      quality: "final",
      json: { transcript: { sourceUrl: url(`videos/${OTHER}.mp4`) } },
    })
    const { files, heldBack } = ownedJobOutputFiles(JOB, output)
    expect(files.map((f) => f.key).sort()).toEqual([`thumbnails/${JOB}.png`, `videos/${JOB}.mp4`])
    // The transcript's source is the input, not this job's file.
    expect(heldBack).toBe(1)
  })

  it("a Seedance extend: the stitch, its poster, its raw .mov (`-raw`) and its copy of the source clip (`-raw-ref`)", () => {
    // Decided 2026-10-08: both are keyed in the job's family and named in its
    // output, so the walk returns them and the job's expiry deletes them —
    // no hold-back (round 12): a later extend reads its own copy.
    const raw = url(`videos/${rawExtensionObjectId(JOB)}.mov`)
    const ref = url(`videos/${rawExtensionReferenceObjectId(JOB)}.mov`)
    const output = {
      videoUrl: url(`videos/${JOB}.mp4`),
      thumbnailUrl: url(`thumbnails/${JOB}.png`),
      rawExtensionUrl: raw,
      chainReferenceUrl: ref,
    }
    const { files, heldBack } = ownedJobOutputFiles(JOB, output)
    expect(files.map((f) => f.key).sort()).toEqual(
      [`thumbnails/${JOB}.png`, `videos/${JOB}-raw-ref.mov`, `videos/${JOB}-raw.mov`, `videos/${JOB}.mp4`],
    )
    expect(heldBack).toBe(0)
  })

  it("Pro 3D Render's child output: the delivered video", () => {
    const output = { sceneRenderResult: { kind: "video", videoUrl: url(`videos/${jobFileObjectId(JOB, "render")}.mp4`), sceneRevisionId: OTHER, elapsedMs: 1 } }
    expect(ownedJobOutputFiles(JOB, output).files).toHaveLength(1)
  })

  it("a variant fan-out (variantJobId): every variant", () => {
    const urls = [0, 1, 2].map((i) => url(`audios/${variantJobId(JOB, i)}.mp3`))
    const { files } = ownedJobOutputFiles(JOB, { audioUrl: urls[0], audioUrls: urls })
    expect(files).toHaveLength(3)
  })

  // Plugin-written (the cloud plugins): pinned by hand, as the app cannot derive them.
  it("Speaker Frames' descriptor: the track body one level down (`json.url`)", () => {
    const output = {
      json: { version: 1, sources: [{ url: url(`videos/${OTHER}.mp4`) }], url: url(`speaker-tracks/${JOB}.json`), sha256: "a".repeat(64), bytes: 10 },
      notes: [],
    }
    const { files, heldBack } = ownedJobOutputFiles(JOB, output)
    expect(files.map((f) => f.key)).toEqual([`speaker-tracks/${JOB}.json`])
    expect(heldBack).toBe(1)
  })

  it("a plugin's intermediates (`<jobId>-segN`, `<jobId>-segN-lastframe`) inside a checkpoint list", () => {
    const output = { videoUrl: url(`videos/${JOB}.mp4`), checkpoint: { segments: [{ url: url(`videos/${JOB}-seg1.mp4`), frame: url(`images/${JOB}-seg1-lastframe.png`) }] } }
    expect(ownedJobOutputFiles(JOB, output).files).toHaveLength(3)
  })
})
