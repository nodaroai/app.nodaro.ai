// "Clear results" is only as complete as its list of result keys, and that list
// goes stale the day a run starts writing a field nobody told it about: the
// canvas is "cleared" and one node still shows its old output.
//
// So this reads the modules that WRITE run output onto nodes and demands a
// decision for every key they write: it is cleared, it is kept on purpose, or
// it is a plan document. A new `updateNodeData(id, { somethingNew: … })` in an
// executor fails here until someone says which of the three it is.
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { basename, dirname, resolve } from "node:path"
import { COMPOSER_PLAN_FIELDS, EXECUTION_DATA_KEYS } from "@nodaro/shared"
import { RUN_INPUT_COPY_KEYS } from "@nodaro/render-rules"
import { RUN_RESULT_EXTRA_KEYS, RUN_RESULT_KEEP_KEYS, RUN_RESULT_TYPE_KEYS } from "../clear-run-results"

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = resolve(HERE, "..")
const SRC = resolve(HERE, "../../../..")

/**
 * Keys the execution modules write that are NOT run results — each with the
 * reason it survives a clear. An entry here is a decision, not an escape hatch:
 * the second test fails when one stops being written anywhere.
 */
const NOT_A_RUN_RESULT: Readonly<Record<string, string>> = {
  // Scene / composer documents beside the plan fields (COMPOSER_PLAN_FIELDS).
  sceneJobBaseRevisionId: "3D-scene revision bookkeeping — part of the editable scene document",
  scenePendingPlan: "3D-scene draft awaiting the person's decision — part of the scene document",
  sceneHistory: "3D-scene revision history — part of the scene document",
  expectedRevisionId: "3D-scene optimistic-concurrency stamp — part of the scene document",
  lottieUrl: "the authored Lottie beside a motion plan — edited and re-rendered, not an output",
  inputVideoUrl: "the upstream video captured FOR the manual editor — an input, not an output",
  inputAssets: "the upstream assets captured FOR the manual editor — inputs, not outputs",
  backgroundMediaUrl: "the resolved background input kept beside a composer plan",
  // State that outlives a run on purpose.
  lastSeenId: "feed cursor — clearing it re-emits every old post on the next scheduled run",
  lastQuoteMaxCredits: "price quote cache shown on the node's cost badge",
  audioDurationSec: "probe of the INPUT audio, cached so the next estimate needs no re-probe",
  // Pointers and UI.
  characterDbId: "pointer to the library entity this card mirrors",
  faceDbId: "pointer to the library entity this card mirrors",
  objectDbId: "pointer to the library entity this card mirrors",
  creatureDbId: "pointer to the library entity this card mirrors",
  locationDbId: "pointer to the library entity this card mirrors",
  createdNodeIds: "which canvas nodes a writer created — structure, not output",
  isEditorOpen: "UI flag",
  // Handled by the clear, but not as a key to delete.
  previewItems: "recollected from the cleared graph (a Preview lists what its upstream holds)",
  itemOrder: "the person's ordering of a Preview's items — rewritten only alongside previewItems",
  rows: "List rows: only CONNECTED cells are emptied (clearedConnectedListRows)",
  // Lives on a node type the clear never touches.
  __triggerData: "written onto trigger SOURCE nodes, which are outside the clear's scope",
}

/**
 * The keys above a clear keeps because they are a copy of what feeds the node (its run captured its
 * input). A clear keeps them; a publish never ships them on a node it empties
 * (`RUN_INPUT_COPY_KEYS`, @nodaro/render-rules). A kept key whose reason calls it an input must be
 * one of these.
 */
const INPUT_COPIES: readonly string[] = ["inputVideoUrl", "inputAssets", "backgroundMediaUrl"]

interface Written {
  readonly key: string
  readonly file: string
}

/** Top-level keys of the object literal that starts at `open` (the index just after its `{`). */
function topLevelKeys(src: string, open: number): string[] {
  let depth = 1
  let i = open
  let flat = ""
  while (i < src.length && depth > 0) {
    const ch = src[i]
    if (ch === "{" || ch === "[" || ch === "(") depth++
    else if (ch === "}" || ch === "]" || ch === ")") depth--
    // Keep only what sits directly inside the literal; blank out nested values.
    flat += depth === 1 && ch !== "}" ? ch : " "
    i++
  }
  const keys: string[] = []
  for (const m of flat.matchAll(/(?:^|,|\n)\s*([A-Za-z_$][\w$]*)\s*(?=:|,|\r?\n|$)/g)) keys.push(m[1])
  return keys
}

/** The text of the balanced bracket group that opens at `open` (which must index a `(` or a `{`). */
function balanced(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === "(" || ch === "{" || ch === "[") depth++
    else if (ch === ")" || ch === "}" || ch === "]") depth--
    if (depth === 0) return src.slice(open, i + 1)
  }
  return src.slice(open)
}

/**
 * Keys a poll EXTRACTOR returns. `pollJobWithNodeUpdate` takes a callback
 * `(od) => fields` and spreads what it returns onto the node — so those keys
 * never appear in an `updateNodeData` literal, and a scanner that only reads
 * literals is blind to them (seven output handles of a stem separation hid
 * there). Three shapes are in use: a returned literal, literals inside a
 * ternary / spread, and `extra[key] = …` over an array of names.
 */
function extractorKeys(src: string): string[] {
  const keys: string[] = []
  for (const m of src.matchAll(/\((?:od|outputData)\)\s*=>\s*/g)) {
    const bodyAt = (m.index ?? 0) + m[0].length
    if (src[bodyAt] !== "(" && src[bodyAt] !== "{") continue
    const body = balanced(src, bodyAt)
    // Any key of any object literal in the body: `{ a: … }`, `{ a }`, `, b: …`.
    for (const k of body.matchAll(/[{,]\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g)) keys.push(k[1])
    for (const k of body.matchAll(/\bextra\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) keys.push(k[1])
    // `extra[key] = …` — the names are the string literals it loops over.
    if (/\bextra\[/.test(body)) for (const k of body.matchAll(/"([A-Za-z_$][\w$]*)"/g)) keys.push(k[1])
  }
  return keys
}

/**
 * Top-level keys of every literal RETURNED by a function typed
 * `): Record<string, unknown>` — the shape of a node-data patch builder. The
 * return type is the filter: the same files return card-state objects
 * (`{ kind, count }`) that are never written onto a node.
 */
function returnedLiteralKeys(src: string): string[] {
  const keys: string[] = []
  for (const fn of src.matchAll(/\)\s*:\s*Record<string,\s*unknown>\s*\{/g)) {
    const body = balanced(src, (fn.index ?? 0) + fn[0].length - 1)
    for (const m of body.matchAll(/\breturn\s*\{/g)) keys.push(...topLevelKeys(body, (m.index ?? 0) + m[0].length))
  }
  return keys
}

function writtenKeys(): Written[] {
  const files = readdirSync(DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => resolve(DIR, e.name))
  // The two load-time recovery lanes write results too — under their own names.
  files.push(resolve(SRC, "hooks/use-workflow-persistence.ts"))
  files.push(resolve(SRC, "lib/reconcile-completed-jobs.ts"))
  // …and the one mapping all three painters share for a node's named side outputs.
  files.push(resolve(SRC, "lib/named-run-outputs.ts"))
  // A scraper's run ledger is built by patch functions that RETURN a literal.
  const PATCH_BUILDERS = [
    resolve(SRC, "components/nodes/web-scrape-run-state.ts"),
    resolve(SRC, "components/nodes/scrape-result-recovery.ts"),
  ]

  const out: Written[] = []
  for (const path of files) {
    const src = readFileSync(path, "utf8")
    const file = basename(path)
    // `updateNodeData(id, { … })` and its local aliases.
    for (const m of src.matchAll(/\b(?:updateNodeData|setNodeData)\(\s*[^,()]+,\s*\{/g)) {
      for (const key of topLevelKeys(src, (m.index ?? 0) + m[0].length)) out.push({ key, file })
    }
    // Patches assembled field by field before one store write.
    for (const m of src.matchAll(/\b(?:updates|patch|runPatch|newData|fields)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) {
      out.push({ key: m[1], file })
    }
    for (const key of extractorKeys(src)) out.push({ key, file })
  }
  for (const path of PATCH_BUILDERS) {
    const file = basename(path)
    for (const key of returnedLiteralKeys(readFileSync(path, "utf8"))) out.push({ key, file })
  }
  return out
}

const CLEARED = new Set<string>([
  ...[...EXECUTION_DATA_KEYS].filter((key) => !RUN_RESULT_KEEP_KEYS.has(key)),
  ...RUN_RESULT_EXTRA_KEYS,
  ...Object.values(RUN_RESULT_TYPE_KEYS).flat(),
])
const DECIDED = new Set<string>([
  ...CLEARED,
  ...RUN_RESULT_KEEP_KEYS.keys(),
  ...COMPOSER_PLAN_FIELDS,
  ...Object.keys(NOT_A_RUN_RESULT),
])

describe("every key a run writes onto a node has a decision", () => {
  const written = writtenKeys()

  it("finds the writes it is meant to police", () => {
    // A regex that silently stops matching would turn this guard into a no-op.
    const keys = new Set(written.map((w) => w.key))
    expect(written.length).toBeGreaterThan(300)
    for (const known of ["executionStatus", "generatedResults", "generatedVideoUrl", "combinedText", "lastSeenId", "alignmentResults"]) {
      expect(keys.has(known), known).toBe(true)
    }
    // One per extractor shape (returned literal · nested spread · `extra.x =` ·
    // `extra[key]` over names) and one from a patch builder: each shape hid real
    // outputs from an earlier version of this scanner.
    for (const hidden of ["generatedSilentVideoUrl", "width", "stems", "drumsUrl", "lastScaleFactor", "warningMessage", "lastGoodCount"]) {
      expect(keys.has(hidden), hidden).toBe(true)
    }
  })

  it("no execution module writes a key that Clear results has not classified", () => {
    const undecided = new Map<string, Set<string>>()
    for (const { key, file } of written) {
      if (DECIDED.has(key)) continue
      if (!undecided.has(key)) undecided.set(key, new Set())
      undecided.get(key)!.add(file)
    }
    const report = [...undecided].map(([key, files]) => `${key}  (${[...files].join(", ")})`).sort()
    expect(
      report,
      "A run writes these node fields and Clear results does not know what they are.\n" +
        "For each: a RESULT goes in RUN_RESULT_EXTRA_KEYS (or RUN_RESULT_TYPE_KEYS when the name is generic)\n" +
        "in clear-run-results.ts; anything that must SURVIVE a clear goes in NOT_A_RUN_RESULT here, with the reason.",
    ).toEqual([])
  })

  it("the survivors list holds only keys that are still written", () => {
    const keys = new Set(written.map((w) => w.key))
    const stale = Object.keys(NOT_A_RUN_RESULT).filter((key) => !keys.has(key))
    expect(stale, "no execution module writes these any more — drop them from NOT_A_RUN_RESULT").toEqual([])
  })

  it("nothing is both cleared and kept", () => {
    const kept = [...RUN_RESULT_KEEP_KEYS.keys(), ...COMPOSER_PLAN_FIELDS, ...Object.keys(NOT_A_RUN_RESULT)]
    // `previewItems` / `rows` are handled structurally, never listed for deletion.
    expect(kept.filter((key) => RUN_RESULT_EXTRA_KEYS.includes(key))).toEqual([])
    expect(kept.filter((key) => Object.values(RUN_RESULT_TYPE_KEYS).flat().includes(key))).toEqual([])
  })

  it("a key kept as a copy of the node's input is one a publish never ships on a node it empties", () => {
    const filedAsInput = Object.entries(NOT_A_RUN_RESULT).filter(([, reason]) => /\binputs?\b/.test(reason)).map(([key]) => key)
    expect(filedAsInput.sort()).toEqual([...INPUT_COPIES].sort())
    expect(INPUT_COPIES.filter((key) => !RUN_INPUT_COPY_KEYS.includes(key))).toEqual([])
  })
})
