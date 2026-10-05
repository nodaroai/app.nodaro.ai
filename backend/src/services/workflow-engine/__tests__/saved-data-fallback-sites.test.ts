/**
 * Where the backend engine reads a node's SAVED results. Two kinds of read are
 * counted, per file:
 *
 *  - a call of a saved-data reader (`extractSavedNodeOutput` & co.), anywhere
 *    in the backend;
 *  - a read of a `SAVED_RESULT_FIELDS` field off a node's data
 *    (`data.generatedText`, `node.data.pickedResults`,
 *    `(n.data as …).generatedJson`, `data["splitResults"]`) in the engine and
 *    the orchestrator — outside the reader modules themselves
 *    (`output-extractor.ts`, `saved-data.ts`), whose callers are counted.
 *
 * Each read is behind the rule in `saved-data.ts` (saved data stands in only
 * for a node this run did not run or gate) or is listed with why it is not
 * this rule's subject. A new read fails this test: gate it, then add it here
 * with the reason.
 *
 * What a count cannot see: a gated read swapped for an ungated one in the
 * same file. The reasons below are the record of what was checked.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { EXECUTION_DATA_KEYS } from "@nodaro/shared"
import { SAVED_RESULT_FIELDS } from "../saved-data.js"

const SRC = join(__dirname, "..", "..", "..")
const READERS = ["extractSavedNodeOutput", "extractAllGeneratedResults", "extractGeneratedJsonAsList", "extractSavedTextFallback", "readSunoIdsFromData"]
const CALL = new RegExp(String.raw`(?<!function )\b(?:${READERS.join("|")})\(`, "g")
const FIELDS = [...SAVED_RESULT_FIELDS].join("|")
const FIELD_READ = new RegExp(
  String.raw`(?:\bdata|\bd|\.data)(?:\s+as\s+[^)]*\))?\??\.(?:${FIELDS})\b|\bdata\[\s*["'](?:${FIELDS})["']\s*\]`,
  "g",
)
const COMMENT = /^\s*(\/\/|\*)/
/** Where field reads are counted: the engine and the orchestrator. */
const FIELD_SCOPE = (where: string) =>
  (where.startsWith("services/workflow-engine/") || where === "workers/orchestrator-worker.ts") &&
  where !== "services/workflow-engine/output-extractor.ts" &&
  where !== "services/workflow-engine/saved-data.ts"

/** File → how many reads of saved node data it makes, and why each is allowed. */
const EXPECTED: Record<string, { count: number; why: string }> = {
  "services/workflow-engine/input-resolver.ts": {
    count: 14,
    why: [
      "calls: getSavedNodeOutput (its one caller asks savedDataAllowed), a connected List column's accumulated results (behind savedDataAllowed; Extract Field / JSON Process go through savedListFor instead), fan-out steps 5b and 6 (after the !savedOk branch), Suno ids (behind savedDataAllowed)",
      "fields: Selector picked/rest x3 pairs (behind savedOk), Generate Text items (behind savedDataAllowed), readSunoIdsFromData itself (its caller asks), producedVideoIn (behind savedDataAllowed)",
    ].join("; "),
  },
  "services/workflow-engine/output-extractor.ts": {
    count: 2,
    why: "calls: extractPrimaryNodeOutput (reached only through memberOutput's savedDataAllowed) and savedOutputFor",
  },
  "services/workflow-engine/payload-builder.ts": {
    count: 5,
    why: [
      "calls: Scene3D references (behind savedDataAllowed)",
      "fields: Split Text's split for a list ref (behind savedDataAllowed)",
      "two wired entities' canonical images (location / object / creature: the entity's own definition, read exactly as the editor preview reads it so both produce the same refs)",
      "generate-mask's fallback image from its OWN data (not an upstream's output)",
    ].join("; "),
  },
  "services/workflow-engine/inline-executor.ts": {
    count: 3,
    why: "calls: Extract Field and JSON Process text fallback (both behind savedDataAllowed); fields: extractSavedTextFallback itself",
  },
  "services/workflow-engine/saved-data.ts": {
    count: 3,
    why: "calls: savedListFor, the reader itself (behind savedDataAllowed) — its history read, and Extract Field / JSON Process's JSON value beside the generic one",
  },
  "services/workflow-engine/scene3d-reference-scoping.ts": { count: 1, why: "calls: layout references, behind savedDataAllowed" },
  "workers/orchestrator-worker.ts": { count: 2, why: "calls: seeding a frozen / outside-the-subset node's state (seededFromSavedData)" },
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : []
  })
}

const codeLines = (text: string): string[] => text.split(/\r?\n/).filter((line) => !COMMENT.test(line))
/** Whitespace collapsed, so a reflow never changes what a pin reads. */
const flat = (text: string): string => codeLines(text).join(" ").replace(/\s+/g, " ")
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length

describe("reads of saved node data", () => {
  it("the result fields are the run's own result keys (one vocabulary with @nodaro/shared)", () => {
    const unlisted = [...SAVED_RESULT_FIELDS].filter((field) => !EXECUTION_DATA_KEYS.has(field))
    expect(unlisted, "Split Text writes splitResults without listing it in EXECUTION_DATA_KEYS").toEqual(["splitResults"])
  })

  it("are exactly the reviewed sites", () => {
    const found: Record<string, number> = {}
    for (const file of sourceFiles(SRC)) {
      const where = relative(SRC, file).replace(/\\/g, "/")
      const text = codeLines(readFileSync(file, "utf8")).join("\n")
      const reads = count(text, CALL) + (FIELD_SCOPE(where) ? count(text, FIELD_READ) : 0)
      if (reads > 0) found[where] = reads
    }
    const expected = Object.fromEntries(Object.entries(EXPECTED).map(([where, { count: n }]) => [where, n]))
    expect(found, "a new read of saved node data: gate it (saved-data.ts), then list it here").toEqual(expected)
  })

  it("sees each spelling of a field read, and not this run's output", () => {
    const reads = (line: string) => count(line, FIELD_READ)
    expect(reads("const t = data.generatedText")).toBe(1)
    expect(reads("const p = sourceNode.data.pickedResults")).toBe(1)
    expect(reads("const j = (node.data as Record<string, unknown>).generatedJson")).toBe(1)
    expect(reads('const s = data["splitResults"]')).toBe(1)
    expect(reads("const u = d.generatedImageUrl")).toBe(1)
    expect(reads("const o = state?.output?.pickedResults ?? output.splitResults")).toBe(0)
  })

  it("a state the run builds from saved data is marked as such, where it is built", () => {
    const read = (where: string) => flat(readFileSync(join(SRC, where), "utf8"))
    // The main run: a frozen or outside-the-subset node, a source, a parameter.
    const worker = read("workers/orchestrator-worker.ts")
    expect(count(worker, /seededFromSavedData\( ?extractSavedNodeOutput\(/g), "seed it through seededFromSavedData").toBe(
      count(worker, /\bextractSavedNodeOutput\(/g),
    )
    expect(worker).toMatch(/seededFromSavedData\( ?output ?\)/)
    expect(worker).toMatch(/seededFromSavedData\( ?hint \? \{ text: hint \} : \{\} ?\)/)
    // Sub-workflows: a source, a parameter, a node the person skipped.
    const sub = read("services/workflow-engine/sub-workflow-handler.ts")
    expect(sub).toMatch(/seededFromSavedData\( ?sourceOutput ?\)/)
    expect(sub).toMatch(/status: "skipped", completedAt: new Date\(\)\.toISOString\(\), fromSavedData: true/)
  })

  it("the fan-out estimate is taken before the run marks its nodes pending (a pending node has no saved list)", () => {
    const worker = flat(readFileSync(join(SRC, "workers/orchestrator-worker.ts"), "utf8"))
    const estimate = worker.indexOf("getListInputForNode(")
    const pending = worker.indexOf('status: "pending",')
    expect(estimate).toBeGreaterThan(0)
    expect(pending).toBeGreaterThan(estimate)
  })
})
