import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, relative, resolve } from "node:path"

/**
 * Every job-status poll loop decides when to give up through ONE rule:
 * `shouldStopPolling` (poll-connection.ts). It stops a loop only when the server
 * says the job is gone. A loop that compares its own failure count against
 * MAX_CONSECUTIVE_POLL_FAILURES goes back to turning a lost connection into a
 * failed node: no message, and a job that finishes afterwards never reaches the
 * canvas. 26 loops did exactly that until 2026-09-28.
 *
 * The constant is defined in types.ts and read by poll-connection.ts. Any other
 * code reference to it fails here, with the file and line.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, "../../../..")
const ALLOWED = new Set([
  "components/editor/workflow-editor/types.ts",
  "components/editor/workflow-editor/poll-connection.ts",
])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...sourceFiles(path))
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

/** Code references only: a comment may still name the constant. */
function codeReferences(text: string): number[] {
  const lines = text.split(/\r?\n/)
  const hits: number[] = []
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "").trim()
    if (code.startsWith("*") || code.startsWith("/*")) return
    if (/\bMAX_CONSECUTIVE_POLL_FAILURES\b/.test(code)) hits.push(i + 1)
  })
  return hits
}

describe("poll loops give up only through shouldStopPolling", () => {
  it("no file but types.ts and poll-connection.ts reads MAX_CONSECUTIVE_POLL_FAILURES", () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split("\\").join("/")
      if (ALLOWED.has(rel)) continue
      for (const line of codeReferences(readFileSync(file, "utf8"))) {
        offenders.push(`${rel}:${line}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it("the rule itself still reads the constant (the guard is not vacuous)", () => {
    const rule = readFileSync(resolve(HERE, "../poll-connection.ts"), "utf8")
    expect(codeReferences(rule).length).toBeGreaterThan(0)
  })
})
