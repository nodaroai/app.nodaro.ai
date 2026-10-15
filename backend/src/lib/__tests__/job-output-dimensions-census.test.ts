// @test-watches backend/src/**/*.ts
/**
 * EVERY IMAGE JOB REPORTS ITS IMAGE'S PIXEL SIZE — the lane census (decided
 * 2026-10-15).
 *
 * A job's image is `output_data.imageUrl` (+ `imageUrls` when it made several):
 * the key the library (`createAssetFromJob`) and the MCP job envelope
 * (`assetKindOf`) read as "an image". Its size is stamped in ONE place —
 * `lib/job-output-dimensions.ts`, run by the completion funnel
 * (`markJobCompletedDetailed`) and by the review approval, the two writers that
 * flip a job to `completed`. So a lane gets the size iff
 *   (a) it completes through those writers — pinned for every writer in the
 *       repo by `workers/__tests__/job-policy-result-totality.test.ts`, and
 *   (b) it publishes its image as `output_data.imageUrl`.
 *
 * This file pins the rest as data:
 *  1. both writers run the stamp BEFORE they write (anti-vacuity);
 *  2. every source file that completes a job AND writes an `imageUrl` key is
 *     classified below — the lanes whose image it publishes, or why that
 *     `imageUrl` is not a job's output. A new file fails until someone decides;
 *  3. every lane named here is a real producer, and the image lanes that do NOT
 *     get a stamped size are listed with the reason.
 */
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { IMAGE_JOB_TYPES } from "../job-finalize.js"
import { ENTITY_MEDIA_JOB_SPECS } from "../entity-finalize.js"
import { imageAIHandlers } from "../../workers/handlers/image-ai.js"
import { ffmpegHandlers } from "../../workers/handlers/ffmpeg.js"
import { videoAIHandlers } from "../../workers/handlers/video-ai.js"
import { entityHandlers } from "../../workers/handlers/entity.js"
import { referenceSheetHandlers } from "../../workers/handlers/reference-sheet.js"
import { createSurroundHandlers } from "../../workers/handlers/surround.js"
import { assetKindOf } from "../mcp/tools/_job-view.js"

const SRC = join(__dirname, "..", "..")

const ENTITY_IMAGE_TYPES = [...ENTITY_MEDIA_JOB_SPECS].filter(([, spec]) => spec.media === "image").map(([type]) => type)

type Entry = { readonly publishes: readonly string[]; readonly via: Record<string, unknown> } | { readonly notAnOutput: string }

/**
 * Every file that completes a job and writes an `imageUrl` key, and what that
 * key is there. `publishes` names the job types whose image it writes (checked
 * against `via`, the handler map that registers them).
 */
const LEDGER: ReadonlyMap<string, Entry> = new Map<string, Entry>([
  // buildImageOutputData — the image half of finalizeJobWithMedia (generate /
  // edit / image-to-image / reference board), `imageUrls` when several.
  ["workers/shared.ts", { publishes: [...IMAGE_JOB_TYPES], via: imageAIHandlers }],
  // The studios' main images and asset variants.
  ["lib/entity-finalize.ts", { publishes: ENTITY_IMAGE_TYPES, via: entityHandlers }],
  // Local sharp / ffmpeg lanes. image-overlay records its own width / height
  // (and each variant's), which the stamp keeps.
  ["workers/handlers/ffmpeg.ts", { publishes: ["extract-frame", "social-media-format", "image-collage", "image-overlay"], via: ffmpegHandlers }],
  // `imageUrl` is the SOURCE image the mask was cut from (the mask is
  // `maskUrl`, the same size) — so its size is the mask's too.
  ["workers/handlers/video-ai.ts", { publishes: ["generate-mask"], via: videoAIHandlers }],
  // The still sheet. The motion sheet publishes its MP4
  // (`reference-sheets/<jobId>.mp4`) under `imageUrl` too; the stamp never
  // reads a video or audio file, by key family or extension.
  ["workers/handlers/reference-sheet.ts", { publishes: ["reference-sheet"], via: referenceSheetHandlers }],
  ["workers/handlers/surround.ts", { publishes: ["generate-surround-continuation"], via: createSurroundHandlers(undefined) }],

  ["workers/handlers/suno.ts", { notAnOutput: "each Suno track's cover art, nested in sunoTracks[] of an audio job" }],
  ["lib/reconcile/kie.ts", { notAnOutput: "the same Suno track cover art, on the reconcile path" }],
  ["workers/handlers/heygen-avatar.ts", { notAnOutput: "the avatar photo sent to HeyGen; the job's output is a video" }],
  ["lib/private-plugins/toolkit.ts", { notAnOutput: "the start frame a plugin's video render sends to the provider (frame fit)" }],
  ["routes/image-overlay-placement.ts", { notAnOutput: "the request's image the vision model reads; the job's output is a placement (JSON)" }],
])

/** Lanes that produce images but get no stamped `width` / `height`, and why. */
const EXEMPT: ReadonlyMap<string, { file: string; why: string }> = new Map([
  ["site-capture", {
    file: "routes/site-capture.ts",
    why: "publishes a page capture, not an image: no top-level imageUrl by design, and the full page and every still already carry their own width and height (lib/site-capture-store.ts)",
  }],
  ["save-to-storage", {
    file: "routes/save-to-storage.ts",
    why: "copies a file the caller already has into storage ({ url, type }); a sink outside the completion funnel, not an image publication",
  }],
])

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "__tests__" || e.name === "node_modules" || e.name === "test") return []
    const p = join(dir, e.name)
    return e.isDirectory() ? tsFiles(p) : e.name.endsWith(".ts") && !e.name.endsWith(".d.ts") ? [p] : []
  })
}

function blankComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ")
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1: string) => p1 + blank(m.slice(p1.length)))
}

const label = (abs: string) => abs.slice(SRC.length + 1).split("\\").join("/")
const read = (rel: string) => readFileSync(join(SRC, ...rel.split("/")), "utf8")

const COMPLETES = /\b(markJobCompleted|markJobCompletedDetailed|finalizeJobWithMedia|finalizeEntityJob)\s*\(/

/**
 * True when `source` BUILDS an object with an `imageUrl` key — `imageUrl: x`,
 * `"imageUrl": x` or the shorthand `{ imageUrl }` — read from the syntax tree,
 * so a destructuring pattern (`const { imageUrl } = data`) or a type
 * (`{ imageUrl: string }`) never counts.
 */
function buildsImageUrlObject(source: string, fileName = "source.ts"): boolean {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const named = (name: ts.PropertyName): boolean =>
    (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === "imageUrl"
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && named(p.name))
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** Files that complete a job and build an object with an `imageUrl` key. */
function imageUrlWriters(): string[] {
  return tsFiles(SRC)
    .filter((abs) => {
      const src = readFileSync(abs, "utf8")
      return COMPLETES.test(blankComments(src)) && buildsImageUrlObject(src, abs)
    })
    .map(label)
    .sort()
}

/** The text of one top-level function, from its declaration to the next top-level declaration. */
function functionBody(src: string, declaration: string): string {
  const start = src.indexOf(declaration)
  expect(start, `${declaration} not found`).toBeGreaterThanOrEqual(0)
  const next = src.slice(start + declaration.length).search(/\n(export )?(async )?function |\nexport (const|type|interface) /)
  return next < 0 ? src.slice(start) : src.slice(start, start + declaration.length + next)
}

describe("the stamp runs in both writers that complete a job", () => {
  it("markJobCompletedDetailed stamps first — the result gate and the CAS both get the stamped fields", () => {
    const body = blankComments(functionBody(read("workers/shared.ts"), "export async function markJobCompletedDetailed("))
    const stamp = body.indexOf("withOutputImageDimensions(fields)")
    expect(stamp).toBeGreaterThan(0)
    expect(body.indexOf("applyResultGate(jobId, stamped")).toBeGreaterThan(stamp)
    expect(body.indexOf("...stamped")).toBeGreaterThan(stamp)
    expect(body).not.toMatch(/applyResultGate\(jobId, fields/)
    expect(body).not.toMatch(/\.\.\.fields\b/)
    // …while the gate's idempotency key stays the lane's own output (D24): the
    // stamped size depends on timing and must not change the key between attempts.
    expect(body).toMatch(/applyResultGate\(jobId, stamped, funnel, commitReplay, \{ hashSubject: /)
  })

  it("the review approval publishes the held output through the stamp", () => {
    const body = blankComments(functionBody(read("lib/job-policy-review.ts"), "export async function approveHeldJob("))
    const stamp = body.indexOf("withImageDimensions(row.held_output_data)")
    expect(stamp).toBeGreaterThan(0)
    expect(body.indexOf("flipApprovedJob(")).toBeGreaterThan(stamp)
  })

  it("the stamp reads the image the library and the MCP envelope read", () => {
    expect(assetKindOf({ imageUrl: "https://cdn/x.png" })).toBe("image")
    expect(blankComments(read("workers/shared.ts"))).toMatch(/key: "imageUrl", type: "image"/)
    expect(blankComments(read("lib/job-output-dimensions.ts"))).toMatch(/out\.imageUrl/)
  })
})

describe("the detector reads the syntax, not the text", () => {
  it("counts an imageUrl key in every spelling an object literal can carry", () => {
    expect(buildsImageUrlObject(`markJobCompleted(id, { output_data: { imageUrl } })`)).toBe(true)
    expect(buildsImageUrlObject(`const out = { imageUrl: url, maskUrl }`)).toBe(true)
    expect(buildsImageUrlObject(`send({ "imageUrl": url })`)).toBe(true)
  })

  it("never counts a destructuring pattern or a type", () => {
    expect(buildsImageUrlObject(`const { imageUrl, prompt } = job.data`)).toBe(false)
    expect(buildsImageUrlObject(`type T = { imageUrl: string }; interface I { imageUrl?: string }`)).toBe(false)
    expect(buildsImageUrlObject(`function f(opts: { imageUrl: string }) { return opts.imageUrl }`)).toBe(false)
  })
})

describe("every file that publishes an imageUrl is classified", () => {
  const found = imageUrlWriters()

  it("scans the real population (the scan is not vacuous)", () => {
    expect(found.length).toBeGreaterThanOrEqual(8)
    expect(found).toContain("workers/shared.ts")
  })

  it("no file completes a job with an imageUrl the ledger does not know", () => {
    const unknown = found.filter((f) => !LEDGER.has(f))
    expect(
      unknown,
      "These files complete a job and write an `imageUrl` key. If it is the job's image, it gets its pixel size " +
        "from the completion funnel automatically (lib/job-output-dimensions.ts) — add the file to LEDGER with the " +
        "lanes it publishes. If it is not a job's output (an input, a nested field, a type), add it with the reason. " +
        "An image published under any OTHER key gets no size: use `imageUrl` (and `imageUrls` for several).",
    ).toEqual([])
  })

  it("has no stale entry", () => {
    expect([...LEDGER.keys()].filter((f) => !found.includes(f))).toEqual([])
  })

  it("every lane it names is registered where the ledger says", () => {
    for (const [file, entry] of LEDGER) {
      if (!("publishes" in entry)) continue
      expect(entry.publishes.length, file).toBeGreaterThan(0)
      for (const type of entry.publishes) expect(Object.keys(entry.via), `${file}: ${type}`).toContain(type)
    }
  })

  it("covers every image type the finalize and studio registries declare", () => {
    const stamped = new Set([...LEDGER.values()].flatMap((e) => ("publishes" in e ? e.publishes : [])))
    for (const type of [...IMAGE_JOB_TYPES, ...ENTITY_IMAGE_TYPES]) expect(stamped, type).toContain(type)
  })
})

describe("image lanes without a stamped size are listed with the reason", () => {
  it("each exempt lane exists, says why, and is not also listed as stamped", () => {
    const stamped = new Set([...LEDGER.values()].flatMap((e) => ("publishes" in e ? e.publishes : [])))
    for (const [type, { file, why }] of EXEMPT) {
      expect(why.length, type).toBeGreaterThan(20)
      expect(read(file).length, file).toBeGreaterThan(0)
      expect(stamped.has(type), type).toBe(false)
    }
  })
})
