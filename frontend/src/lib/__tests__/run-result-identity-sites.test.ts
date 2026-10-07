/**
 * Every lane that lands a take also lands its identity (A1b): its thumbnail
 * and, for a render, its `quality` and `clipKey` (lib/run-result-identity.ts).
 *
 * Each lane that builds a result entry already keeps the take's Transcript
 * (`applyEdlTakeTranscriptField`), so that call marks a landing site: a file
 * with N of them must stamp N identities (`runResultIdentity` /
 * `runResultRowIdentity`). A new lane that lands takes without the identity
 * fails here. The two lanes that land takes another way are pinned by name.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC = join(__dirname, "..", "..")
const COMMENT = /^\s*(\/\/|\*)/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

const code = (file: string): string => readFileSync(file, "utf8").split(/\r?\n/).filter((l) => !COMMENT.test(l)).join("\n")
const count = (text: string, re: RegExp): number => (text.match(re) ?? []).length

describe("every lane that lands a take lands its identity", () => {
  it("as many identities as take landings, per file", () => {
    const found: Record<string, { takes: number; identities: number }> = {}
    for (const file of sourceFiles(SRC)) {
      const where = relative(SRC, file).replace(/\\/g, "/")
      if (where === "lib/apply-edl-cut.ts" || where === "lib/run-result-identity.ts") continue
      const text = code(file)
      const takes = count(text, /\bapplyEdlTakeTranscriptField\(/g)
      if (takes === 0) continue
      found[where] = { takes, identities: count(text, /\brunResult(?:Row)?Identity\(/g) }
    }
    expect(Object.keys(found).sort()).toEqual([
      "components/editor/workflow-editor/run-handlers.ts",
      "hooks/use-workflow-persistence.ts",
      "lib/reconcile-completed-jobs.ts",
    ])
    for (const [where, { takes, identities }] of Object.entries(found)) {
      expect(identities, `${where}: a lane lands a take without its identity`).toBe(takes)
    }
  })

  it("the single-node run puts a render's identity on the result only, and the browser fan-out keeps what each iteration landed", () => {
    const executors = code(join(SRC, "components/editor/workflow-editor/node-executors.ts"))
    expect(executors).toMatch(/resultFields: \(od\) => runResultIdentity\("apply-edl", od\)/)
    const list = code(join(SRC, "components/editor/workflow-editor/list-execution.ts"))
    expect(list).toMatch(/\.\.\.landed\.get\(url\)/)
  })
})
