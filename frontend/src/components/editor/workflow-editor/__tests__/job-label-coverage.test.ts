import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { LABEL_TABLES } from "@/lib/i18n/labels"
import { isJobLabel } from "../job-label"

/**
 * The pollers name a job in their toasts ("Trim Audio complete", "Failed to
 * start Video generation"). An executor passes that name as an English
 * literal; `localizeJobLabel` translates it through the node-label tables or
 * the job-label keys. A literal in neither would reach a Hebrew or Japanese
 * toast in English, so every one the executors pass is checked here.
 */
const DIR = path.resolve(__dirname, "..")
/** Poll helpers and the index of their label argument. */
const LABEL_ARG: Readonly<Record<string, number>> = {
  runProcessingNode: 3,
  pollJobWithNodeUpdate: 3,
  pollImageRefineToNode: 2,
}

function passedLabels(): Array<{ readonly file: string; readonly label: string }> {
  const found: Array<{ file: string; label: string }> = []
  for (const name of fs.readdirSync(DIR).filter((n) => n.endsWith(".ts"))) {
    const file = path.join(DIR, name)
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && Object.hasOwn(LABEL_ARG, node.expression.text)) {
        const arg = node.arguments[LABEL_ARG[node.expression.text]]
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) found.push({ file: name, label: arg.text })
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

describe("job labels", () => {
  it("every label an executor passes to a poller is translated in every locale", () => {
    const labels = passedLabels()
    // Floor, so a refactor that hides the calls fails loudly instead of passing empty.
    expect(labels.length).toBeGreaterThan(50)
    const missing = labels.flatMap(({ file, label }) =>
      isJobLabel(label)
        ? []
        : Object.entries(LABEL_TABLES)
            .filter(([, tables]) => !(label in (tables?.node ?? {})))
            .map(([locale]) => `${file}: "${label}" has no ${locale} node label — add it to the node tables or to JOB_LABEL_KEYS`),
    )
    expect(missing).toEqual([])
  })
})
