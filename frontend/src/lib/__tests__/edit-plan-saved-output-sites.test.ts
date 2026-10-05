/**
 * Every editor read of an Edit Plan's saved output goes through
 * `editPlanOutputOf` (lib/edit-plan-saved-output.ts → @nodaro/shared
 * `editPlanSavedOutput`), so a person's review (`editedEdl`, TA13) wins on the
 * canvas exactly as it wins on the server. A read of `generatedJson` or
 * `__listResults` inside an Edit Plan branch hands downstream the clips the
 * person dropped, or the cut they changed.
 *
 * What it checks, over every non-test source file:
 *  - the body of each Edit Plan branch — an `if` on `=== "edit-plan"` (its
 *    block, or its one statement) and a ternary arm `=== "edit-plan" ? …` —
 *    reads neither field;
 *  - the Edit Plan node and its config panel (`EditPlanConfig`, sliced out of
 *    processing-configs.tsx) read neither field;
 *  - the browser engine reads a SOURCE's JSON (Extract Field, JSON Process)
 *    through `sourceJsonOf`, never `src.data.generatedJson` — that read has no
 *    Edit Plan branch, so the branch check above cannot see it;
 *  - only the reader module calls the shared `editPlanSavedOutput`;
 *  - the reviewed sites (§6 item 11 of the review design) call the reader;
 *  - a plan landing clears the review only when it is a different plan, and
 *    only through `editPlanResultPatch` (decided 2026-10-05).
 *
 * What it cannot see: a generic read (no Edit Plan branch) that an Edit Plan
 * reaches. The engines' own test (edit-plan-review-engines.test.ts) covers the
 * readers it knows; a new generic one needs a case there.
 */
import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { EDITED_EDL_VERSION, editPlanBasis } from "@nodaro/shared"
import { jsonRunResultPatch } from "../json-run-result"

const SRC = join(__dirname, "..", "..")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const FILES = sourceFiles(SRC).map((path) => ({
  where: relative(SRC, path).replace(/\\/g, "/"),
  text: readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line.replace(/\s\/\/.*$/, "")))
    .join("\n"),
}))

/** A read of a saved plan's raw fields (a key in an object literal is a write). */
const RAW_READ = /\.(?:generatedJson|__listResults)\b|\[\s*["'](?:generatedJson|__listResults)["']\s*\]/g

/** The browser engine's executors and input resolver. */
const ENGINE_FILES = [
  "components/editor/workflow-editor/execute-node.ts",
  "components/editor/workflow-editor/node-input-resolver.ts",
]

/** A read of a SOURCE node's `generatedJson` (Extract Field / JSON Process style). */
const SOURCE_JSON_READ = /\(\s*src\.data\s+as\b[^)]*\)\s*\.generatedJson\b|\bsrc\.data\.generatedJson\b|\bsrcData\s*(?:\.generatedJson\b|\[\s*["']generatedJson["']\s*\])/

/** `EditPlanConfig`'s body: from its declaration to the next top-level export. */
function editPlanConfigBody(): string {
  const text = FILES.find(({ where }) => where === "components/editor/config-panels/processing-configs.tsx")!.text
  const start = text.indexOf("export function EditPlanConfig(")
  if (start < 0) return ""
  const next = text.slice(start + 1).search(/\nexport /)
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)
}

/** From an opening brace at `open`, the text up to its matching close. */
function block(text: string, open: number): string {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1)
  }
  return text.slice(open)
}

/** The body of each Edit Plan branch in `text`. */
function editPlanBranches(text: string): string[] {
  const bodies: string[] = []
  for (const match of text.matchAll(/===\s*["']edit-plan["']/g)) {
    const after = text.slice(match.index! + match[0].length)
    const ternary = /^\s*\?/.exec(after)
    if (ternary) {
      // The arm, up to the `:` that starts the next arm.
      const end = after.search(/\n\s*:/)
      bodies.push(end < 0 ? after : after.slice(0, end))
      continue
    }
    // An `if` condition: the rest of it, then a block or one statement.
    const close = /^[^;?{}\n]*\)\s*/.exec(after)
    if (!close) continue
    const rest = after.slice(close[0].length)
    if (rest.startsWith("{")) bodies.push(block(rest, 0))
    else {
      const end = rest.search(/;|\n/)
      bodies.push(end < 0 ? rest : rest.slice(0, end + 1))
    }
  }
  return bodies
}

describe("editor reads of an Edit Plan's saved output", () => {
  it("no Edit Plan branch reads the raw plan or a persisted list", () => {
    const offenders = FILES.flatMap(({ where, text }) =>
      editPlanBranches(text)
        .filter((body) => (body.match(RAW_READ) ?? []).length > 0)
        .map((body) => `${where}: ${body.slice(0, 120).replace(/\s+/g, " ")}`),
    )
    expect(offenders, "read it through editPlanOutputOf (lib/edit-plan-saved-output.ts)").toEqual([])
  })

  it("finds the branches it is meant to check", () => {
    const branches = FILES.flatMap(({ where, text }) => editPlanBranches(text).map(() => where))
    for (const where of [
      "components/editor/workflow-editor/execution-graph.ts",
      "components/editor/workflow-editor/node-input-resolver.ts",
      "components/editor/workflow-editor/types.ts",
      "lib/apply-edl-estimate.ts",
      "lib/json-run-result.ts",
    ]) {
      expect(branches, where).toContain(where)
    }
  })

  it("sees a raw read in an if block, a one-line if and a ternary arm", () => {
    const flagged = (text: string) => editPlanBranches(text).some((body) => (body.match(RAW_READ) ?? []).length > 0)
    expect(flagged(`if (node.type === "edit-plan") {\n  const plan = data.generatedJson\n}`)).toBe(true)
    expect(flagged(`if (producer.type === "edit-plan") return data.generatedJson`)).toBe(true)
    expect(flagged(`: src.type === "edit-plan"\n  ? (srcData.__listResults as string[])\n  : other`)).toBe(true)
    expect(flagged(`if (node.type === "edit-plan") return { generatedJson: plan, editedEdl: undefined }`)).toBe(false)
    expect(flagged(`if (node.type === "edit-plan") return editPlanOutputOf(data)?.json`)).toBe(false)
  })

  it("the Edit Plan node and its config panel never read the raw plan", () => {
    const own = [
      ...FILES.filter(({ where }) => /(^|\/)edit-plan[-\w]*\.tsx?$/.test(where) && where !== "lib/edit-plan-saved-output.ts"),
      // The config panel shares a file with the other processing panels.
      { where: "components/editor/config-panels/processing-configs.tsx#EditPlanConfig", text: editPlanConfigBody() },
    ]
    expect(own.map(({ where }) => where)).toContain("components/nodes/edit-plan-node.tsx")
    for (const { where, text } of own) expect(text.match(RAW_READ) ?? [], where).toEqual([])
  })

  it("slices the config panel's own body out of its file", () => {
    const body = editPlanConfigBody()
    expect(body).toMatch(/^export function EditPlanConfig\(/)
    expect(body).toContain("setSourceRole")
    expect(body).not.toMatch(/\nexport function (?!EditPlanConfig\b)/)
  })

  it("the browser engine reads a source's JSON through sourceJsonOf", () => {
    const offenders: Record<string, string[]> = {}
    for (const where of ENGINE_FILES) {
      const text = FILES.find((f) => f.where === where)!.text
      const lines = text.split("\n").filter((line) => SOURCE_JSON_READ.test(line)).map((line) => line.trim())
      if (lines.length > 0) offenders[where] = lines
    }
    expect(offenders).toEqual({
      // Video Audit's `analysis` wire, gated on an ANALYSIS_PRODUCER_TYPES
      // source: an Edit Plan never reaches it.
      "components/editor/workflow-editor/node-input-resolver.ts": [
        "const analysisJson = (src.data as { generatedJson?: unknown }).generatedJson;",
      ],
    })
    const calls = (FILES.find((f) => f.where === "components/editor/workflow-editor/execute-node.ts")!.text.match(/\bsourceJsonOf\(/g) ?? []).length
    // Extract Field and JSON Process.
    expect(calls).toBe(2)
  })

  it("sees a raw read of a source's JSON in every spelling", () => {
    for (const line of [
      "let value: unknown = (src.data as { generatedJson?: unknown }).generatedJson;",
      "const json = src.data.generatedJson",
      "const json = srcData.generatedJson",
      'const json = srcData["generatedJson"]',
    ]) expect(SOURCE_JSON_READ.test(line), line).toBe(true)
    expect(SOURCE_JSON_READ.test("let value: unknown = sourceJsonOf(src);")).toBe(false)
  })

  it("only the reader calls the shared resolver", () => {
    const callers = FILES.filter(({ text }) => /\beditPlanSavedOutput\(/.test(text)).map(({ where }) => where)
    expect(callers).toEqual(["lib/edit-plan-saved-output.ts"])
  })

  it("the reviewed sites call the reader", () => {
    const calls: Record<string, number> = {}
    for (const { where, text } of FILES) {
      const n = (text.match(/\beditPlanOutputOf\(/g) ?? []).length
      if (n > 0) calls[where] = n
    }
    expect(calls).toEqual({
      // extractNodeOutput's scalar
      "components/editor/workflow-editor/execution-graph.ts": 1,
      // extractNodeOutputAsList (resolveNodeInputs and the fan-out read through it)
      "components/editor/workflow-editor/node-input-resolver.ts": 1,
      // editPlanClipFanOut, the run estimate's clip count
      "components/editor/workflow-editor/types.ts": 1,
      // persistedEdlPlan, the render estimate's minutes
      "lib/apply-edl-estimate.ts": 1,
      // the node's badge, clip count and tree
      "components/nodes/edit-plan-node.tsx": 1,
      // the reader itself (its cache), and sourceJsonOf (Extract Field and
      // JSON Process read a source's JSON through it)
      "lib/edit-plan-saved-output.ts": 2,
    })
  })

  it("resolveNodeInputs reads an Edit Plan's list before the generic __listResults", () => {
    const text = FILES.find(({ where }) => where === "components/editor/workflow-editor/node-input-resolver.ts")!.text
    const flat = text.replace(/\s+/g, " ")
    const branch = flat.indexOf(`src.type === "edit-plan" ? extractNodeOutputAsList(src`)
    const generic = flat.indexOf("const fromState = (srcData.__listResults")
    expect(branch).toBeGreaterThan(0)
    expect(generic).toBeGreaterThan(branch)
  })
})

// Decided 2026-10-05: a result writer clears `editedEdl` ONLY when the plan
// that lands is not the one the edit was made on (its `editPlanBasis` differs
// from `editedEdl.basis`). The same plan landing again (a reopen after the run
// finished, a reconcile, a re-run that plans the same) keeps the edit. The one
// rule is `@nodaro/shared`'s `editPlanResultPatch`; every writer goes through it.
const PLAN = { version: 1, segments: [{ id: "seg-0", inMs: 0, outMs: 1000, video: "cam" }], dropped: [] }
const EDIT = { v: EDITED_EDL_VERSION, kind: "edl", basis: editPlanBasis(PLAN), edl: { segments: [], dropped: [] } }
const has = (o: object | undefined, key: string) => !!o && Object.prototype.hasOwnProperty.call(o, key)

/** Every non-test source file under a package's `src`. */
function packageSources(...segments: string[]) {
  const root = join(SRC, "..", "..", ...segments)
  return sourceFiles(root).map((path) => ({
    where: relative(join(SRC, "..", ".."), path).replace(/\\/g, "/"),
    text: readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => (/^\s*(\/\/|\*|\/\*)/.test(line) ? "" : line.replace(/\s\/\/.*$/, "")))
      .join("\n"),
  }))
}

/** A write that clears the review: a key set to nothing, an assignment, a delete. */
const CLEARS_REVIEW =
  /\beditedEdl\s*:\s*(?:undefined|null)\b|\.editedEdl\s*=(?!=)|\[\s*["']editedEdl["']\s*\]\s*=(?!=)|\bdelete\s+[\w$.?]*(?:\.editedEdl|\[\s*["']editedEdl["']\s*\])/

describe("a plan landing keeps the review made on it (decided 2026-10-05)", () => {
  it("the same plan landing keeps the edit (jsonRunResultPatch, every run-result lane)", () => {
    const patch = jsonRunResultPatch("edit-plan", { json: JSON.parse(JSON.stringify(PLAN)) }, { data: { generatedJson: PLAN, editedEdl: EDIT } })
    expect(patch).toEqual({ generatedJson: PLAN })
    expect(has(patch, "editedEdl")).toBe(false)
  })

  it("a different plan landing clears it", () => {
    const replanned = { ...PLAN, dropped: [{ inMs: 1000, outMs: 2000, reason: "silence" }] }
    const patch = jsonRunResultPatch("edit-plan", { json: replanned }, { data: { generatedJson: PLAN, editedEdl: EDIT } })
    expect(patch).toEqual({ generatedJson: replanned, editedEdl: undefined })
    expect(has(patch, "editedEdl")).toBe(true)
  })

  it("the same plan landing on a node whose plan was reset at run start keeps the edit", () => {
    // The canvas run clears generatedJson when it starts; the edit stays and
    // is compared with the plan that lands, not with the one it replaced.
    const patch = jsonRunResultPatch("edit-plan", { json: PLAN }, { data: { editedEdl: EDIT } })
    expect(has(patch, "editedEdl")).toBe(false)
  })

  it("the census sees a clearing write in every spelling", () => {
    for (const line of [
      "return { generatedJson: plan, editedEdl: undefined }",
      "updates.editedEdl = undefined",
      'data["editedEdl"] = null',
      "delete data.editedEdl",
      "delete next['editedEdl']",
      "patch = { editedEdl: null }",
    ]) expect(CLEARS_REVIEW.test(line), line).toBe(true)
    for (const line of [
      "const edited = data.editedEdl",
      "if (data.editedEdl === undefined) return",
      "...editPlanResultPatch(plan, data.editedEdl)",
      '"editedEdl",',
    ]) expect(CLEARS_REVIEW.test(line), line).toBe(false)
  })

  it("no writer in the editor, the server or @nodaro/shared clears the review outside editPlanResultPatch", () => {
    const files = [
      ...FILES.map((f) => ({ ...f, where: `frontend/src/${f.where}` })),
      ...packageSources("backend", "src"),
      ...packageSources("packages", "shared", "src"),
    ]
    expect(files.some(({ where }) => where.startsWith("backend/src/"))).toBe(true)
    expect(files.some(({ where }) => where === "packages/shared/src/edit-plan-review.ts")).toBe(true)
    const offenders = files.flatMap(({ where, text }) =>
      text
        .split("\n")
        .filter((line) => CLEARS_REVIEW.test(line))
        .map((line) => `${where}: ${line.trim()}`),
    )
    expect(offenders.filter((o) => !o.startsWith("packages/shared/src/edit-plan-review.ts:")), "land a plan through editPlanResultPatch").toEqual([])
    // The helper itself is the one clearing write.
    expect(offenders.length).toBe(1)
  })

  it("every place a plan lands goes through editPlanResultPatch", () => {
    const calls: Record<string, number> = {}
    const unwraps: Record<string, number> = {}
    for (const { where, text } of FILES) {
      const n = (text.match(/\beditPlanResultPatch\(/g) ?? []).length
      if (n > 0) calls[where] = n
      const u = (text.match(/\bunwrapEditPlanOutput\(/g) ?? []).length
      if (u > 0) unwraps[where] = u
    }
    expect(calls).toEqual({
      // jsonRunResultPatch: every run-result lane (live, reload, reopen, job restores)
      "lib/json-run-result.ts": 1,
      // the canvas run's poll
      "components/editor/workflow-editor/execute-node.ts": 1,
    })
    // Each plan the editor unwraps from a job lands through the helper.
    expect(unwraps).toEqual(calls)
    const engine = FILES.find(({ where }) => where === "components/editor/workflow-editor/execute-node.ts")!.text
    expect(engine).not.toMatch(/generatedJson:\s*plan\b/)
  })
})
