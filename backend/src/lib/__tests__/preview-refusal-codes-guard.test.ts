// @test-watches backend/src/**/*.{ts,tsx} frontend/src/**/*.{ts,tsx} packages/shared/src/** packages/render-rules/src/** packages/client/src/** packages/cli/src/** packages/prompts/src/**
/**
 * A preview refusal has six codes: the two a render-held refusal (and every
 * older row) carries, and the same two when a review-on use-case node — or
 * both kinds — holds the run. They all mean one thing, so no code anywhere
 * may branch on ONE of them (an equality, a switch case, a lookup keyed by
 * it): it must ask `isPreviewRefusalCode`, or read the kind with
 * `previewRefusalOfCode`. The only place the codes are listed is where they
 * are defined.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { isPreviewRefusalCode } from "@nodaro/shared/nodes"
import { previewRefusalCode, previewRefusalOfCode } from "@nodaro/render-rules"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..")
const SCANNED = ["backend/src", "frontend/src", "packages/shared/src", "packages/render-rules/src", "packages/client/src", "packages/cli/src", "packages/prompts/src"]
/** Where the codes are defined and the one table that maps kind → code. */
const DEFINITIONS = new Set(["packages/shared/src/preview-gate.ts", "packages/render-rules/src/preview-hold-kind.ts"])

const CODE = String.raw`(?:PREVIEW_REVIEW_REQUIRED|PREVIEW_RENDER_NESTED)(?:_REVIEW_ON|_MIXED)?\b|["'\x60]preview_(?:review_required|render_nested)(?:_review_on|_mixed)?["'\x60]`
/** A code (or its family's prefix) as a quoted literal, unterminated: what a prefix test spells. */
const PREFIX = String.raw`["'\x60]preview_(?:review|render)`
const BRANCHES = [
  // An equality, either way round.
  new RegExp(String.raw`[!=]==?\s*(?:${CODE})`),
  new RegExp(String.raw`(?:${CODE})\s*[!=]==?`),
  // A switch case.
  new RegExp(String.raw`\bcase\s+(?:${CODE})`),
  // A table keyed by one: computed, quoted or bare.
  new RegExp(String.raw`\[\s*(?:${CODE})\s*\]\s*:`),
  new RegExp(String.raw`(?:^|[{,]\s*)(?:["'\x60]preview_(?:review_required|render_nested)(?:_review_on|_mixed)?["'\x60]|\bpreview_(?:review_required|render_nested)(?:_review_on|_mixed)?)\s*:(?!:)`),
  // A set, a list or a query filter that holds one.
  new RegExp(String.raw`\.(?:has|includes|indexOf)\(\s*(?:${CODE})\s*\)`),
  new RegExp(String.raw`\[[^\]]*(?:${CODE})[^\]]*\]\s*\.(?:includes|indexOf|some|find)\(`),
  new RegExp(String.raw`new\s+(?:Set|Map)\(\s*\[[^\]]*(?:${CODE})`),
  new RegExp(String.raw`\.(?:eq|neq|in|is|contains|filter|match)\([^)]*(?:${CODE})`),
  // A prefix test on the codes' family.
  new RegExp(String.raw`\.(?:startsWith|endsWith|includes)\(\s*${PREFIX}`),
  new RegExp(String.raw`\.(?:startsWith|endsWith)\(\s*(?:${CODE})`),
  // A code imported under another name: every check above would miss its uses.
  new RegExp(String.raw`\b(?:PREVIEW_REVIEW_REQUIRED|PREVIEW_RENDER_NESTED)(?:_REVIEW_ON|_MIXED)?\s+as\s+[A-Za-z_$]`),
]

function sources(dir: string): string[] {
  let out: string[] = []
  let entries: string[] = []
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name === "__tests__") continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out = out.concat(sources(path))
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !/\.test\.(ts|tsx|js|mjs|cjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(path)
  }
  return out
}

describe("no code branches on one preview refusal code", () => {
  it("every branch asks the predicate or reads the kind", () => {
    const offenders: string[] = []
    let scanned = 0
    for (const dir of SCANNED) {
      const files = sources(join(ROOT, dir))
      // Every root holds sources: a wrong ROOT or a renamed directory would otherwise pass vacuously.
      expect(files.length, dir).toBeGreaterThan(0)
      scanned += files.length
      for (const file of files) {
        const rel = relative(ROOT, file)
        if (DEFINITIONS.has(rel)) continue
        readFileSync(file, "utf8").split("\n").forEach((line, i) => {
          if (BRANCHES.some((re) => re.test(line))) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
        })
      }
    }
    expect(scanned).toBeGreaterThan(2000)
    expect(offenders).toEqual([])
  })

  it("its patterns catch every way of branching on one code it knows of", () => {
    const branches = [
      `if (code === PREVIEW_REVIEW_REQUIRED) {`,
      `if ("preview_render_nested" !== code) {`,
      `case PREVIEW_RENDER_NESTED_MIXED:`,
      `const t = { [PREVIEW_REVIEW_REQUIRED]: "x" }`,
      `const t = { preview_review_required: "x" }`,
      `const t = { "preview_render_nested_review_on": "x" }`,
      `if (CODES.includes(PREVIEW_REVIEW_REQUIRED)) {`,
      `if ([PREVIEW_REVIEW_REQUIRED, PREVIEW_RENDER_NESTED].includes(code)) {`,
      `const held = new Set([PREVIEW_REVIEW_REQUIRED_REVIEW_ON])`,
      `q.eq("error_message", PREVIEW_REVIEW_REQUIRED)`,
      `if (message.startsWith("preview_review")) {`,
      `if (code.startsWith(PREVIEW_RENDER_NESTED)) {`,
      `import { PREVIEW_REVIEW_REQUIRED as HELD } from "@nodaro/shared"`,
    ]
    for (const line of branches) expect(BRANCHES.some((re) => re.test(line)), line).toBe(true)
    // What a refusal may do: send one, or ask the predicate.
    for (const line of [`reply.status(409).send({ error: { code: PREVIEW_REVIEW_REQUIRED, message } })`, `if (isPreviewRefusalCode(code)) {`, `return held ? PREVIEW_RENDER_NESTED : null`]) {
      expect(BRANCHES.some((re) => re.test(line)), line).toBe(false)
    }
  })

  it("the predicate accepts exactly the codes the kind table reads (every spelling of the family)", () => {
    const candidates = ["preview_review_required", "preview_render_nested"].flatMap((base) =>
      ["", "_review_on", "_mixed", "_render", "_review", "_any", "_both", "_nested"].map((suffix) => base + suffix),
    )
    for (const code of candidates) expect(isPreviewRefusalCode(code), code).toBe(previewRefusalOfCode(code) !== undefined)
    expect(candidates.filter((c) => isPreviewRefusalCode(c))).toHaveLength(6)
  })

  it("the predicate and the kind table name the same six codes, both ways", () => {
    const codes = (["headless", "nested"] as const).flatMap((family) => (["render", "review", "any"] as const).map((kind) => previewRefusalCode(family, kind)))
    expect(new Set(codes).size).toBe(6)
    for (const code of codes) {
      expect(isPreviewRefusalCode(code)).toBe(true)
      expect(previewRefusalCode(previewRefusalOfCode(code)!.family, previewRefusalOfCode(code)!.kind)).toBe(code)
    }
    expect(isPreviewRefusalCode("continuation_not_found")).toBe(false)
    expect(previewRefusalOfCode("continuation_not_found")).toBeUndefined()
    // Every older row's code is the render's.
    expect(previewRefusalOfCode("preview_review_required")).toEqual({ family: "headless", kind: "render" })
    expect(previewRefusalOfCode("preview_render_nested")).toEqual({ family: "nested", kind: "render" })
  })
})
