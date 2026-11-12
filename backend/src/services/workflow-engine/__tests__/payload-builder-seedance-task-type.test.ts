// @test-watches backend/src/services/workflow-engine/payload-builder.ts
/**
 * buildPayload: a video node's Seedance 2.5 reference task type.
 *
 * The three general video lanes (Generate Video, and the older Image to Video
 * and Text to Video node types) put the REQUESTED `referenceTaskType` on the
 * payload when the lane's model lists it, and return the arguments their credit
 * id was built from (`videoCreditIdArgs`). The builder resolves nothing — it
 * cannot measure the reference clips; the node executor resolves the request
 * and, when the resolution moves the length, re-prices from those arguments
 * (lib/seedance-task-type-stamp.ts). A node that requests nothing, or a model
 * that takes no task type, builds exactly today's result.
 */
import { describe, it, expect } from "vitest"
import ts from "typescript"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildPayload, type PayloadResult } from "../payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../types.js"
import { buildVideoCreditModelIdentifier } from "@nodaro/shared/credits"
import { SEEDANCE_REFERENCE_TASK_TYPES } from "@nodaro/shared/models"
import { DYNAMIC_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIP = "https://cdn.example.com/clip.mp4"
const FRAME = "https://cdn.example.com/frame.png"
const jobId = "job-1"

const node = (type: string, data: Record<string, unknown>): SimpleNode => ({ id: "n1", type, data })

/** The payload with the requested key taken off. */
function withoutTaskType(payload: Record<string, unknown>): Record<string, unknown> {
  const { referenceTaskType: _dropped, ...rest } = payload
  return rest
}

/** The id `buildVideoCreditModelIdentifier` builds from a result's own price arguments. */
function idFromArgs(result: PayloadResult): string {
  const a = result.videoCreditIdArgs
  if (!a) throw new Error("the result carries no price arguments")
  return buildVideoCreditModelIdentifier(a.provider, a.duration, a.sound, a.mode, a.sizeOrMode, a.resolution, a.hasVideoRef)
}

/** One lane: its node type, a node data that runs on Seedance 2.5, and the inputs that make it a reference run. */
interface Lane {
  type: "generate-video" | "text-to-video" | "image-to-video"
  data: Record<string, unknown>
  inputs: ResolvedInputs
}

const LANES: Lane[] = [
  {
    type: "generate-video",
    data: { provider: "seedance-2-5", prompt: "make it black and white", aspectRatio: "16:9", duration: 5, resolution: "720p" },
    inputs: { referenceVideoUrls: [CLIP] },
  },
  {
    type: "text-to-video",
    data: { provider: "seedance-2-5", prompt: "make it black and white", aspectRatio: "16:9", duration: 5, resolution: "720p" },
    inputs: { referenceVideoUrls: [CLIP] },
  },
  {
    type: "image-to-video",
    data: { provider: "seedance-2-5", prompt: "she turns to camera", aspectRatio: "16:9", duration: 5, resolution: "720p" },
    inputs: { imageUrl: FRAME, referenceVideoUrls: [CLIP] },
  },
]

describe("a Generate Video node requests the Seedance 2.5 task type it carries", () => {
  const lane = LANES[0]!
  const plain = () => buildPayload(node(lane.type, lane.data), jobId, { ...lane.inputs })

  it("seedance-2-5, edit, a wired reference video: the request rides the payload, nothing else moves, and the price arguments come back", () => {
    const asked = buildPayload(node(lane.type, { ...lane.data, referenceTaskType: "edit" }), jobId, { ...lane.inputs })
    const before = plain()
    expect(asked.payload.referenceTaskType).toBe("edit")
    expect(withoutTaskType(asked.payload)).toStrictEqual(before.payload)
    expect(asked.jobName).toBe(before.jobName)
    expect(asked.queueName).toBe(before.queueName)
    expect(asked.modelIdentifier).toBe(before.modelIdentifier)
    expect(asked.videoCreditIdArgs).toStrictEqual({
      provider: "seedance-2-5",
      duration: 5,
      sound: undefined,
      mode: "text-to-video",
      sizeOrMode: undefined,
      resolution: "720p",
      hasVideoRef: true,
    })
    expect(idFromArgs(asked)).toBe(asked.modelIdentifier)
  })

  it.each([
    ["a model that takes no task type (kling-3.0)", { provider: "kling-3.0", referenceTaskType: "edit" }],
    ['"auto"', { referenceTaskType: "auto" }],
    ['"bogus"', { referenceTaskType: "bogus" }],
    ["a wrong case", { referenceTaskType: "Edit" }],
  ])("%s: the whole result is today's", (_name, extra) => {
    const base = { ...lane.data, ...("provider" in extra ? { provider: extra.provider } : {}) }
    const without = buildPayload(node(lane.type, base), jobId, { ...lane.inputs })
    const asked = buildPayload(node(lane.type, { ...base, referenceTaskType: extra.referenceTaskType }), jobId, { ...lane.inputs })
    expect(asked).toStrictEqual(without)
    expect(asked.payload).not.toHaveProperty("referenceTaskType")
    expect(asked).not.toHaveProperty("videoCreditIdArgs")
  })

  it("a node that requests nothing builds no price arguments", () => {
    expect(plain()).not.toHaveProperty("videoCreditIdArgs")
  })
})

describe("the Text to Video and Image to Video node types", () => {
  for (const lane of LANES.slice(1)) {
    it(`${lane.type}: carries a listed request, with its price arguments`, () => {
      const before = buildPayload(node(lane.type, lane.data), jobId, { ...lane.inputs })
      const asked = buildPayload(node(lane.type, { ...lane.data, referenceTaskType: "extend" }), jobId, { ...lane.inputs })
      expect(asked.payload.referenceTaskType).toBe("extend")
      expect(withoutTaskType(asked.payload)).toStrictEqual(before.payload)
      expect(asked.modelIdentifier).toBe(before.modelIdentifier)
      expect(asked.videoCreditIdArgs).toMatchObject({ provider: "seedance-2-5", mode: lane.type, duration: 5, resolution: "720p", hasVideoRef: true })
      expect(idFromArgs(asked)).toBe(asked.modelIdentifier)
    })

    it(`${lane.type}: a model that takes no task type builds today's result`, () => {
      const data = { ...lane.data, provider: "kling-3.0" }
      const without = buildPayload(node(lane.type, data), jobId, { ...lane.inputs })
      const asked = buildPayload(node(lane.type, { ...data, referenceTaskType: "extend" }), jobId, { ...lane.inputs })
      expect(asked).toStrictEqual(without)
      expect(asked.payload).not.toHaveProperty("referenceTaskType")
    })
  }
})

describe("each lane's price arguments are the ones its id was built from", () => {
  // Image to Video and Generate Video read `videoSize` before `mode`, Text to
  // Video reads `mode` first: the arguments keep each lane's own precedence.
  it.each<[Lane["type"], string]>([
    ["generate-video", "high"],
    ["image-to-video", "high"],
    ["text-to-video", "pro"],
  ])("%s with both mode and videoSize set: the fifth argument is %s", (type, expected) => {
    const lane = LANES.find((l) => l.type === type)!
    const result = buildPayload(node(type, { ...lane.data, mode: "pro", videoSize: "high", sound: true, referenceTaskType: "reference" }), jobId, { ...lane.inputs })
    expect(result.videoCreditIdArgs?.sizeOrMode).toBe(expected)
    expect(result.videoCreditIdArgs?.sound).toBe(true)
    expect(idFromArgs(result)).toBe(result.modelIdentifier)
  })
})

// ---------------------------------------------------------------------------
// The guard: a payload that requests a task type must come with the arguments
// its price is rebuilt from, or the executor cannot re-price a run whose length
// the resolution moves (it then drops the declaration and warns). The one
// exemption is the Video to Video node's Seedance edit: its built shape is
// already the edit's (adaptive, Auto length), so the resolution moves nothing
// priced and there is nothing to rebuild.
// ---------------------------------------------------------------------------

const DECLARED = SEEDANCE_REFERENCE_TASK_TYPES.filter((t) => t !== "auto")

describe("guard: no lane requests a task type without its price arguments", () => {
  for (const lane of LANES) {
    it.each(DECLARED)(`${lane.type}, %s`, (taskType) => {
      const result = buildPayload(node(lane.type, { ...lane.data, referenceTaskType: taskType }), jobId, { ...lane.inputs })
      expect(result.payload.referenceTaskType).toBe(taskType)
      expect(result.videoCreditIdArgs, "a lane that requests a task type returns its price arguments").toBeDefined()
    })
  }

  it("the exemption: the Video to Video node's Seedance edit is already in the edit's shape", () => {
    const result = buildPayload(node("video-to-video", { provider: "seedance-2-5", v2vResolution: "480p" }), jobId, { videoUrl: CLIP, prompt: "make it noir" })
    expect(result.payload.referenceTaskType).toBe("edit")
    expect(result.payload).toMatchObject({ aspectRatio: "adaptive", duration: -1 })
    expect(result).not.toHaveProperty("videoCreditIdArgs")
  })

  it("the source has exactly the two known places that put the key on a payload", () => {
    const sites = writtenKeySites(readFileSync(join(HERE, "..", "payload-builder.ts"), "utf8"))
    expect(
      sites.map((site) => site.where),
      "A new place puts referenceTaskType on a payload. Build the lane's result through videoGenerationResult " +
        "(it returns the price arguments the executor re-prices from), or add a reasoned exemption here.",
    ).toStrictEqual([
      // videoGenerationResult: always returns the price arguments with it.
      "videoGenerationResult",
      // The Video to Video node's Seedance edit (the exemption above).
      'buildPayloadOf › case "video-to-video"',
    ])
  })
})

// The behavioural half of the guard: a key a lane writes through a helper
// imported from another module (as `...seedanceDraftField(...)` writes `draft`)
// is invisible to the source scan, so every node type that makes a video is
// built with a Seedance 2.5 edit request, a wired reference clip and the other
// common inputs, and a payload that carries the key must come with its price
// arguments. A type this minimal input cannot build is skipped BY NAME below.
const SWEEP_CLIP = "https://cdn.example.com/sweep.mp4"
const SWEEP_IMAGE = "https://cdn.example.com/sweep.png"
const SWEEP_AUDIO = "https://cdn.example.com/sweep.mp3"
const SWEEP_INPUTS = {
  referenceVideoUrls: [SWEEP_CLIP], videoUrl: SWEEP_CLIP, videoUrls: [SWEEP_CLIP],
  imageUrl: SWEEP_IMAGE, imageUrls: [SWEEP_IMAGE], startFrameUrl: SWEEP_IMAGE, audioUrl: SWEEP_AUDIO, prompt: "make it noir",
} as ResolvedInputs

/** Not built by the payload builder at all: sources, and nodes run inline or as use cases. */
const NOT_BUILT_HERE = [
  "upload-video", "youtube-video", "manual-edit", "list", "sub-workflow", "reduce",
  "ugc-clip", "ugc-finish-clips", "episode-trailer", "speaker-layout", "tighten-episode", "clip-pack",
]
/** Built here, but refused without settings or wiring this minimal input does not give. */
const NEEDS_MORE_INPUT = [
  "face-swap", "speaker-view", "mask-composite", "ai-avatar", "cinematic-avatar", "video-overlay", "voice-changer-pro", "apply-edl",
]

describe("guard sweep: every video-making node type built with a Seedance 2.5 edit request", () => {
  const types = [...new Set([...VIDEO_PRODUCER_TYPES, ...DYNAMIC_PRODUCER_TYPES])].sort()
  const skipped = new Set([...NOT_BUILT_HERE, ...NEEDS_MORE_INPUT])

  it.each(types)("%s", (type) => {
    let result: PayloadResult
    try {
      result = buildPayload(node(type, { provider: "seedance-2-5", referenceTaskType: "edit", prompt: "make it noir" }), jobId, { ...SWEEP_INPUTS })
    } catch (err) {
      expect(skipped.has(type), `${type} cannot be built from the sweep's input (${(err as Error).message}) — list it by name`).toBe(true)
      return
    }
    if (Object.prototype.hasOwnProperty.call(result.payload, KEY) && type !== "video-to-video") {
      expect(result.videoCreditIdArgs, `${type} requests a task type without its price arguments`).toBeDefined()
    }
  })

  it("the skip lists name only video-making node types", () => {
    for (const type of skipped) expect(types, type).toContain(type)
  })

  it("the sweep is not empty: it reaches the lanes known to request the type", () => {
    const requesting = types.filter((type) => {
      try {
        return Object.prototype.hasOwnProperty.call(buildPayload(node(type, { provider: "seedance-2-5", referenceTaskType: "edit", prompt: "x" }), jobId, { ...SWEEP_INPUTS }).payload, KEY)
      } catch {
        return false
      }
    })
    expect(requesting).toEqual(expect.arrayContaining(["generate-video", "image-to-video", "text-to-video", "video-to-video"]))
  })
})

describe("the guard's source scan finds every way of writing the key, and nothing else", () => {
  const wrap = (body: string) => `function lane(data: Record<string, unknown>, out: Record<string, unknown>) {\n${body}\n}`
  it.each([
    ["a plain key", "return { prompt: 'x', referenceTaskType: data.t }"],
    ["a shorthand key", "const referenceTaskType = data.t; return { referenceTaskType }"],
    ["a double-quoted key", 'return { "referenceTaskType": data.t }'],
    ["a single-quoted key", "return { 'referenceTaskType': data.t }"],
    ["a computed key", 'return { ["referenceTaskType"]: data.t }'],
    ["a bracket assignment", 'out["referenceTaskType"] = data.t'],
    ["a property assignment", "out.referenceTaskType = data.t"],
  ])("%s is a write", (_name, body) => {
    expect(writtenKeySites(wrap(body))).toHaveLength(1)
  })

  it.each([
    ["a read", "return data.referenceTaskType"],
    ["a destructuring read", "const { referenceTaskType: requested, ...rest } = data; return { requested, rest }"],
    ["a shorthand destructuring read", "const { referenceTaskType } = data; return referenceTaskType"],
    ["a type member", "type T = { referenceTaskType?: string; other: number }; return 1 as unknown as T"],
    ["a comparison", 'return out.referenceTaskType === "edit"'],
    ["a mention in a comment", "// referenceTaskType: data.t\nreturn 1"],
  ])("%s is not a write", (_name, body) => {
    expect(writtenKeySites(wrap(body))).toStrictEqual([])
  })
})

const KEY = "referenceTaskType"

/** A property name's text: `a`, `"a"`, `'a'` and `["a"]` are all `a`. */
function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text
  return undefined
}

/** `node` is the target of an assignment (`({ a } = b)`), where an object literal is a destructuring read. */
function isAssignmentTarget(node: ts.Node): boolean {
  const parent = node.parent
  return !!parent && ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === node
}

/** Where a site sits: its enclosing named function, and the switch case around it inside that function. */
function whereOf(node: ts.Node): string {
  let caseLabel: string | undefined
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (!caseLabel && ts.isCaseClause(at) && ts.isStringLiteralLike(at.expression)) caseLabel = `case "${at.expression.text}"`
    if (ts.isFunctionDeclaration(at) && at.name) return caseLabel ? `${at.name.text} › ${caseLabel}` : at.name.text
  }
  return caseLabel ?? "(top level)"
}

/**
 * Every place `source` WRITES a `referenceTaskType` property — an object
 * literal key (plain, shorthand, quoted or computed) or an assignment to one
 * (`x.referenceTaskType = …`, `x["referenceTaskType"] = …`) — with where it is.
 * A read, a destructuring read (a binding pattern, or an object literal that is
 * an assignment target), a type member and a comment are not writes.
 */
function writtenKeySites(source: string): Array<{ where: string }> {
  const file = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true)
  const sites: Array<{ where: string }> = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
      ts.isObjectLiteralExpression(node.parent) && !isAssignmentTarget(node.parent) &&
      propertyNameText(node.name) === KEY
    ) {
      sites.push({ where: whereOf(node) })
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = node.left
      const named = ts.isPropertyAccessExpression(target)
        ? target.name.text
        : ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression) ? target.argumentExpression.text : undefined
      if (named === KEY) sites.push({ where: whereOf(node) })
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return sites
}
