import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { MULTI_PICKERS, SINGLE_PICKERS } from "@/lib/picker-ui"
import { LABEL_TABLES } from "../labels"

/**
 * Handle pips are localized by looking their English label up in each
 * locale's `handle` table (labels.<locale>.ts, registered in LABEL_TABLES), so
 * an unmapped label silently renders English next to otherwise translated pips. node-labels-coverage.test.ts covers
 * the target-handle registry; most OUTPUT pips (Mask, Vocals, Approved,
 * Composition …) are written straight on `<HandleWithPopover label="…">` in
 * the node components or in the `lib/*handles.ts` definition modules — this
 * scan covers those, so a new pip is caught the day it is added.
 */
const SRC = path.resolve(__dirname, "../../..")
const TIMEOUT = 60_000

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(p)
  }
  return out
}

/** String-literal labels (incl. both arms of a ternary) on every <HandleWithPopover>. */
function componentHandleLabels(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of walk(path.join(SRC, "components"))) {
    const src = fs.readFileSync(file, "utf8")
    if (!src.includes("HandleWithPopover")) continue
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const note = (lit: ts.Node, text: string) => {
      if (!found.has(text)) found.set(text, `${path.relative(SRC, file)}:${sf.getLineAndCharacterOfPosition(lit.getStart()).line + 1}`)
    }
    const visit = (node: ts.Node) => {
      if (ts.isJsxAttribute(node) && node.name.getText() === "label" && node.initializer) {
        const el = node.parent.parent
        if (ts.isJsxOpeningLikeElement(el) && el.tagName.getText() === "HandleWithPopover") {
          let value: ts.Node = node.initializer
          if (ts.isJsxExpression(value) && value.expression) value = value.expression
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) note(value, value.text)
          else if (ts.isConditionalExpression(value)) {
            for (const arm of [value.whenTrue, value.whenFalse]) if (ts.isStringLiteral(arm)) note(arm, arm.text)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return found
}

/** `label: "X"` entries in the handle definition modules (rendered via label={h.label}). */
function definitionModuleLabels(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of walk(path.join(SRC, "lib")).filter((f) => /handles\.ts$/.test(f))) {
    const src = fs.readFileSync(file, "utf8")
    for (const m of src.matchAll(/\blabel:\s*"([^"]+)"/g)) {
      if (!found.has(m[1])) found.set(m[1], `${path.relative(SRC, file)}:${src.slice(0, m.index).split("\n").length}`)
    }
  }
  return found
}

describe("every locale's handle table covers every pip label written in components and handle modules", () => {
  it(
    "no English-only pip label",
    () => {
      const all = new Map([...componentHandleLabels(), ...definitionModuleLabels()])
      // Floor so a reformat that hides every label fails loudly instead of passing for free.
      expect(all.size).toBeGreaterThan(80)
      const missing = Object.entries(LABEL_TABLES).flatMap(([locale, tables]) =>
        [...all]
          .filter(([label]) => /[A-Za-z]{2,}/.test(label) && !(label in (tables?.handle ?? {})))
          .map(([l, where]) => `${locale}: ${JSON.stringify(l)}  (${where})`),
      )
      expect(missing, "pip labels with no entry in a locale's handle table").toEqual([])
    },
    TIMEOUT,
  )
})

/**
 * A parameter picker's registry label (@nodaro/picker-ui) is its source-pip
 * name on the canvas (`ParameterNodeShell` passes it to HandleWithPopover) and
 * the name the published-app picker cards put in their sentences ("Search era
 * / period…", `presentation/picker-label.ts`). It is not a string literal on the
 * pip, so the scan above cannot see it.
 */
describe("every locale's handle table covers every parameter-picker registry label", () => {
  it("no English-only picker name", () => {
    const labels = [...new Set([...SINGLE_PICKERS, ...MULTI_PICKERS].map((m) => m.label))]
    // Floor so an emptied or reshaped registry fails loudly instead of passing for free.
    expect(labels.length).toBeGreaterThan(30)
    const missing = Object.entries(LABEL_TABLES).flatMap(([locale, tables]) =>
      labels.filter((l) => !(l in (tables?.handle ?? {}))).map((l) => `${locale}: ${JSON.stringify(l)}`),
    )
    expect(missing, "picker registry labels with no entry in a locale's handle table").toEqual([])
  })
})
