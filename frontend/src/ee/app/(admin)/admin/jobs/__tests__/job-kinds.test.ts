// @test-watches backend/src/**/*.ts packages/shared/src/**/*.ts
import { describe, it, expect } from "vitest"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { AUDIO_PRODUCER_TYPES, DYNAMIC_PRODUCER_TYPES, IMAGE_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES } from "@nodaro/shared/nodes"
import { HANDLE_OUTPUT_TYPES } from "@/lib/handle-output-types"
import { JOB_TYPE_KINDS, OTHER_JOB_TYPES, jobKindOf, nodeKindOf, otherJobTypes, rowJobType, typesOfKind } from "../job-kinds"

describe("job kinds", () => {
  it("llm-chat-stream is text", () => expect(jobKindOf("llm-chat-stream")).toBe("text"))
  it("apply-edl is video", () => expect(jobKindOf("apply-edl")).toBe("video"))
  it("generate-video is video", () => expect(jobKindOf("generate-video")).toBe("video"))
  it("generate-image is image", () => expect(jobKindOf("generate-image")).toBe("image"))
  it("text-to-speech is audio", () => expect(jobKindOf("text-to-speech")).toBe("audio"))
  it("suno-generate is music", () => expect(jobKindOf("suno-generate")).toBe("music"))
  it("llm-chat is text", () => expect(jobKindOf("llm-chat")).toBe("text"))
  it("an unknown type has no kind", () => expect(jobKindOf("no-such-type")).toBeNull())
  it("a name every object carries is no kind", () => {
    for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(jobKindOf(name), name).toBeNull()
      expect(nodeKindOf(name), name).toBeNull()
    }
  })

  it("typesOfKind lists every type of the kind, sorted, and only those", () => {
    const video = typesOfKind("video")
    expect(video).toContain("generate-video")
    expect(video).toContain("apply-edl")
    expect(video).toEqual([...video].sort())
    for (const t of video) expect(jobKindOf(t)).toBe("video")
    expect(typesOfKind("music")).toContain("suno-generate")
    expect(typesOfKind("audio")).not.toContain("suno-generate")
    expect(typesOfKind("text")).toContain("llm-chat-stream")
  })

  it("every type with a kind is listed under that kind", () => {
    const universe = new Set<string>([
      ...Object.keys(JOB_TYPE_KINDS),
      ...VIDEO_PRODUCER_TYPES, ...IMAGE_PRODUCER_TYPES, ...AUDIO_PRODUCER_TYPES, ...DYNAMIC_PRODUCER_TYPES,
      ...Object.keys(HANDLE_OUTPUT_TYPES),
    ])
    for (const t of universe) {
      const kind = jobKindOf(t)
      if (kind) expect(typesOfKind(kind)).toContain(t)
    }
  })

  // The table names only the row types the node registries cannot classify;
  // a node type in it would be a second, drifting copy of its kind.
  it("JOB_TYPE_KINDS holds no type the node registries already classify", () => {
    const redundant = Object.keys(JOB_TYPE_KINDS).filter((t) => nodeKindOf(t) !== null).map((t) => `${t}: ${nodeKindOf(t)}`)
    expect(redundant).toEqual([])
  })
})

describe("Other: row types with none of the five kinds", () => {
  it("no type is both Other and of a kind", () => {
    expect([...OTHER_JOB_TYPES].filter((t) => jobKindOf(t) !== null)).toEqual([])
  })
  it("a worker node unit whose outputs give it no kind is Other, from its manifest", () => {
    expect(jobKindOf("speaker-map")).toBeNull()
    expect(otherJobTypes()).toContain("speaker-map")
  })
  it("otherJobTypes lists them all, sorted, and keeps them findable by exact type", () => {
    const other = otherJobTypes()
    expect(other).toContain("social-publish")
    expect(other).toEqual([...OTHER_JOB_TYPES].sort())
    expect(new Set(other).size).toBe(OTHER_JOB_TYPES.size)
  })
})

describe("rowJobType", () => {
  it("job_type fallback", () => {
    expect(rowJobType({ job_type: "image-to-video", input_data: null })).toBe("image-to-video")
  })
  it("input_data.type wins", () => {
    expect(rowJobType({ job_type: "video", input_data: { type: "generate-video" } })).toBe("generate-video")
  })
  it("an empty or non-string input_data.type falls back to job_type", () => {
    expect(rowJobType({ job_type: "llm", input_data: { type: "" } })).toBe("llm")
    expect(rowJobType({ job_type: "llm", input_data: { type: 3 } })).toBe("llm")
  })
  it("neither: null", () => {
    expect(rowJobType({ job_type: null, input_data: {} })).toBeNull()
  })
})

// ── Guard: every row type the backend writes has a kind ─────────────────────

function findRepoRoot(from: string): string {
  let dir = from
  while (!existsSync(join(dir, "backend", "src"))) {
    const up = dirname(dir)
    if (up === dir) throw new Error("repo root not found")
    dir = up
  }
  return dir
}
const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)))
const BACKEND_SRC = join(ROOT, "backend", "src")

function backendSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue
      out.push(...backendSources(p))
    } else if (entry.name.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(entry.name)) {
      out.push(p)
    }
  }
  return out
}

const TYPE = String.raw`["'\`]([a-z0-9][a-z0-9_.:-]*)["'\`]`
/** Literal forms that name a row's type: `input_data.type` or the bare `job_type`. */
const LITERAL_PATTERNS: readonly RegExp[] = [
  new RegExp(String.raw`\bjob_type:\s*${TYPE}`, "g"),
  // `job_type: jobName` / `job_type: jobType` callers.
  new RegExp(String.raw`\bjob(?:Name|Type):\s*${TYPE}`, "g"),
  // `input_data: { type: "x" }` and `input_data: { ...body, type: "x" }`.
  new RegExp(String.raw`\binput_data:\s*\{[^{}]*?\btype:\s*${TYPE}`, "g"),
  // `const CHARACTER_LORA_TRAINING_JOB_TYPE = "x"` → `job_type: CHARACTER_LORA_TRAINING_JOB_TYPE`.
  new RegExp(String.raw`\b[A-Z0-9_]*JOB_TYPE\s*=\s*${TYPE}`, "g"),
  // The video worker stamps `job_type: job.name` at pickup — the queue name.
  new RegExp(String.raw`\bvideoQueue\.add\(\s*${TYPE}`, "g"),
]
/** Calls whose Nth argument (0-based) becomes the row's type. */
const TYPE_ARGUMENT: Readonly<Record<string, number>> = {
  buildJobInputData: 1,
  structuredJobInputData: 2,
  meterSyncLlm: 2,
  meterSyncLlmMetered: 2,
  meterOptionalSyncLlm: 2,
  // Route-local wrappers that pass their argument on as the row's type:
  // `nodaro-exclusive.ts` (`jobHandler(type, schema)`) and
  // `social-post-reads.ts` (`startJob(req, userId, type, input)`).
  jobHandler: 0,
  startJob: 2,
}

/** The top-level arguments of the call whose `(` is at `open`, as source text. */
function callArguments(src: string, open: number): string[] {
  const args: string[] = []
  let depth = 0
  let start = open + 1
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i)
      if (i < 0) break
      continue
    }
    if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i + 2) + 1
      if (i <= 0) break
      continue
    }
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++
      continue
    }
    // A type argument (`Record<string, unknown>`): `<` straight after a name.
    if (c === "<" && /[A-Za-z0-9_]/.test(src[i - 1] ?? "")) depth++
    else if (c === ">" && src[i - 1] !== "=" && depth > 1) depth--
    else if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") {
      depth--
      if (depth === 0) {
        args.push(src.slice(start, i))
        return args.map((a) => a.trim()).filter((a, idx, all) => a !== "" || idx < all.length - 1)
      }
    } else if (c === "," && depth === 1) {
      args.push(src.slice(start, i))
      start = i + 1
    }
  }
  return args
}

/** `const NAME = "x"` (and `const A = B` aliases) across the backend and
 *  `@nodaro/shared`, so a type passed by constant is read too. */
function stringConstants(files: readonly string[]): ReadonlyMap<string, string> {
  const values = new Map<string, string>()
  const aliases = new Map<string, string>()
  for (const file of files) {
    const src = readFileSync(file, "utf8")
    for (const m of src.matchAll(new RegExp(String.raw`\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=]+)?=\s*${TYPE}`, "g"))) values.set(m[1]!, m[2]!)
    for (const m of src.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*([A-Z][A-Z0-9_]*)\s*$/gm)) aliases.set(m[1]!, m[2]!)
  }
  for (const [name, target] of aliases) {
    const value = values.get(target)
    if (value && !values.has(name)) values.set(name, value)
  }
  return values
}

interface Found { readonly type: string; readonly at: string }
function collectRowTypes(): { found: Found[]; unread: string[] } {
  const found: Found[] = []
  const unread: string[] = []
  const lit = new RegExp(`^${TYPE}$`)
  const files = backendSources(BACKEND_SRC)
  const constants = stringConstants([...files, ...backendSources(join(ROOT, "packages", "shared", "src"))])
  const valueOf = (arg: string): string | undefined => lit.exec(arg)?.[1] ?? constants.get(arg)
  for (const file of files) {
    const src = readFileSync(file, "utf8")
    const rel = relative(ROOT, file)
    const at = (index: number) => `${rel}:${src.slice(0, index).split("\n").length}`
    for (const re of LITERAL_PATTERNS) for (const m of src.matchAll(re)) found.push({ type: m[1]!, at: at(m.index!) })
    for (const m of src.matchAll(/\bjob_type:\s*([A-Z][A-Z0-9_]*)\b/g)) {
      const value = constants.get(m[1]!)
      if (value) found.push({ type: value, at: at(m.index!) })
    }
    for (const [fn, argIndex] of Object.entries(TYPE_ARGUMENT)) {
      for (const m of src.matchAll(new RegExp(String.raw`(?<!function\s)\b${fn}\s*(?:<[^>]*>)?\(`, "g"))) {
        // A mention in a comment writes no row.
        const lineStart = src.lastIndexOf("\n", m.index!) + 1
        if (/^(?:\/\/|\/\*|\*)/.test(src.slice(lineStart, m.index!).trimStart())) continue
        const arg = callArguments(src, m.index! + m[0].length - 1)[argIndex]
        // A declaration (`buildJobInputData(body: …, type: string)`), not a call.
        if (arg !== undefined && /^[A-Za-z_$][\w$]*\??\s*:/.test(arg)) continue
        const value = arg === undefined ? undefined : valueOf(arg)
        const prefix = arg === undefined ? undefined : /^`([a-z0-9][a-z0-9_.:-]*)\$\{/.exec(arg)?.[1]
        if (value) found.push({ type: value, at: at(m.index!) })
        else if (prefix) found.push({ type: `${prefix}*`, at: at(m.index!) })
        else unread.push(`${rel} ${fn}(${arg ?? "<default>"})`)
      }
    }
  }
  return { found, unread }
}

/**
 * Call sites whose type argument is a variable the scan cannot read, keyed by
 * file, called function and argument — never a line number, so an edit
 * elsewhere in the file moves nothing. Each names the literal types that reach
 * it; every one of them has a kind or is Other.
 */
const PINNED_UNREAD: ReadonlyArray<readonly [site: string, types: string]> = [
  ["backend/src/lib/llm-structured-request.ts buildJobInputData(type)", "structuredJobInputData's type: llm-structured, else its callers'"],
  ["backend/src/routes/llm-structured.ts structuredJobInputData(<default>)", "llm-structured (the default)"],
  ["backend/src/lib/llm-billing.ts meterSyncLlm(jobType)", "meterSyncLlmMetered's jobType, read at each of its calls"],
  ["backend/src/lib/meter-sync-llm.ts meterSyncLlmMetered(jobType)", "meterOptionalSyncLlm's jobType, read at each of its calls"],
  ["backend/src/routes/nodaro-exclusive.ts buildJobInputData(jobType)", "enqueueExclusive's jobType: each jobHandler(…) call's, read there, and the continue route's generate-video-pro"],
  ["backend/src/routes/social-post-reads.ts buildJobInputData(nodeType)", "the nodeType of each startJob(…) call, read there"],
  ["backend/src/nodes/split-into-layers/route.ts buildJobInputData(descriptor.type)", "split-into-layers, the unit's own node type: its kind is its node's"],
]

/** Literals the scan reads that are not row types. Each needs a reason. */
const IGNORED: ReadonlyMap<string, string> = new Map([])


/** A found type, or a template's static prefix (`prompt-wizard:*`): a prefix
 *  has a kind when the table names at least one type under it. */
function kindOfFound(type: string): string | null {
  if (!type.endsWith("*")) return jobKindOf(type)
  const prefix = type.slice(0, -1)
  return Object.keys(JOB_TYPE_KINDS).some((k) => k.startsWith(prefix)) ? "prefix" : null
}

describe("guard: every row type the backend writes has a kind", () => {
  const { found } = collectRowTypes()

  it("the scan reads the backend's row types", () => {
    const types = new Set(found.map((f) => f.type))
    // Both vocabularies: an `input_data.type` and a bare queue `job_type`.
    expect(types).toContain("llm-chat-stream")
    expect(types).toContain("generate-character-asset")
    expect(types).toContain("pipeline-final-merge")
    expect(types).toContain("prompt-wizard:*")
    expect(types).toContain("character-lora-training")
    expect(types.size).toBeGreaterThan(100)
  })

  it("every type has a kind or is Other", () => {
    const kindless = [...new Set(found.filter((f) => !IGNORED.has(f.type) && !OTHER_JOB_TYPES.has(f.type) && kindOfFound(f.type) === null).map((f) => `${f.type} (${f.at})`))]
    expect(kindless).toEqual([])
  })

  it("every call site the scan cannot read is pinned, with the types that reach it", () => {
    const { unread } = collectRowTypes()
    const pinned = PINNED_UNREAD.map(([site]) => site)
    const left = [...pinned]
    const unpinned = unread.filter((site) => {
      const i = left.indexOf(site)
      if (i < 0) return true
      left.splice(i, 1)
      return false
    })
    expect(
      unpinned,
      "A new call passes its row type through a variable this scan cannot read. Give every literal type that " +
        "reaches it a kind (JOB_TYPE_KINDS) or list it in OTHER_JOB_TYPES, then pin the site in PINNED_UNREAD with those types.",
    ).toEqual([])
    expect(left, "A pinned site is gone (moved, renamed or now read as a literal): remove it from PINNED_UNREAD.").toEqual([])
  })

  it("IGNORED and OTHER_JOB_TYPES list only literals the scan still finds", () => {
    const types = new Set(found.map((f) => f.type))
    expect([...IGNORED.keys(), ...OTHER_JOB_TYPES].filter((t) => !types.has(t))).toEqual([])
  })
})
