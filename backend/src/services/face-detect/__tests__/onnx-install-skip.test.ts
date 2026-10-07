/**
 * onnxruntime-node's postinstall downloads the CUDA 12 and TensorRT libraries
 * from NuGet on linux/x64 unless ONNXRUNTIME_NODE_INSTALL=skip. The detector
 * only loads the CPU runtime the package carries, so no install wants them.
 *
 * Decided 2026-10-07: the skip is the ENVIRONMENT VARIABLE only. The repo has
 * no `.npmrc` key for it (npm 11 warns "Unknown project config" on every
 * command for a key that is not its own, and npm 12 drops such keys). So every
 * place that installs dependencies must set the variable itself, and the docs
 * must tell a linux/x64 developer to export it. This file pins both halves.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect } from "vitest"

// backend/src/services/face-detect/__tests__/ → up 5 → repo root
const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..")
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8")

const INSTALLS = /\bnpm\s+(ci|install|i)\b/
const nonComment = (line: string) => !/^\s*#/.test(line)

interface Stage {
  name: string
  base: string
  lines: string[]
}

function dockerStages(text: string): Stage[] {
  const stages: Stage[] = []
  for (const line of text.split("\n")) {
    const from = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(line)
    if (from) {
      stages.push({ base: from[1]!, name: from[2] ?? from[1]!, lines: [] })
      continue
    }
    stages.at(-1)?.lines.push(line)
  }
  return stages
}

const SKIP_ENV = /^\s*ENV\s+ONNXRUNTIME_NODE_INSTALL=skip\s*$/

describe("onnxruntime-node install: skip the CUDA download by env var only", () => {
  it("the repo .npmrc carries no onnxruntime key (decided 2026-10-07)", () => {
    const path = join(REPO_ROOT, ".npmrc")
    const text = existsSync(path) ? readFileSync(path, "utf8") : ""
    const keys = text.split("\n").filter(nonComment).filter((l) => /onnxruntime/i.test(l))
    expect(keys).toEqual([])
  })

  it("every Dockerfile stage that installs dependencies has ONNXRUNTIME_NODE_INSTALL=skip in scope", () => {
    const stages = dockerStages(read("Dockerfile"))
    const byName = new Map(stages.map((s) => [s.name, s]))
    const hasSkip = (stage: Stage | undefined): boolean =>
      stage !== undefined &&
      (stage.lines.some((l) => SKIP_ENV.test(l)) ||
        (byName.get(stage.base) !== stage && hasSkip(byName.get(stage.base))))

    const installing = stages.filter((s) => s.lines.filter(nonComment).some((l) => INSTALLS.test(l)))
    expect(installing.map((s) => s.name)).toEqual(expect.arrayContaining(["deps", "prod-deps"]))
    expect(installing.filter((s) => !hasSkip(s)).map((s) => s.name)).toEqual([])
  })

  it("every workflow that installs dependencies sets it in its top-level env", () => {
    const dir = join(REPO_ROOT, ".github", "workflows")
    const missing: string[] = []
    let checked = 0
    for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
      const lines = readFileSync(join(dir, file), "utf8").split("\n")
      if (!lines.filter(nonComment).some((l) => INSTALLS.test(l))) continue
      checked++
      const start = lines.findIndex((l) => /^env:\s*$/.test(l))
      const block: string[] = []
      for (let i = start + 1; start >= 0 && i < lines.length; i++) {
        if (/^\S/.test(lines[i]!) && !/^#/.test(lines[i]!)) break
        block.push(lines[i]!)
      }
      if (!block.some((l) => /^\s+ONNXRUNTIME_NODE_INSTALL:\s*"?skip"?\s*$/.test(l))) missing.push(file)
    }
    expect(checked).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it("the in-image characterization script exports it before its npm ci", () => {
    const script = read("backend/scripts/characterize-in-image.sh")
    const exportAt = script.indexOf("export ONNXRUNTIME_NODE_INSTALL=skip")
    expect(exportAt).toBeGreaterThan(-1)
    expect(exportAt).toBeLessThan(script.search(/^\s*npm ci\b/m))
  })

  it("the docs tell a linux/x64 development install to export it, and name no .npmrc key", () => {
    for (const doc of ["docs/deployment.md", "docs/contributing.md"]) {
      const text = read(doc)
      expect(text, doc).toContain("export ONNXRUNTIME_NODE_INSTALL=skip")
      expect(text, doc).not.toContain("onnxruntime-node-install")
    }
  })

  it("contributing.md exports it before the first install command a reader runs", () => {
    // A contributor copies the setup commands top to bottom; an export that
    // follows the first `npm install` comes too late for that install.
    const lines = read("docs/contributing.md").split("\n")
    const exportAt = lines.findIndex((l) => /^\s*export ONNXRUNTIME_NODE_INSTALL=skip\b/.test(l))
    const installAt = lines.findIndex((l) => /^\s*npm\s+(ci|install|i)\b/.test(l))
    expect(exportAt).toBeGreaterThan(-1)
    expect(installAt).toBeGreaterThan(-1)
    expect(exportAt).toBeLessThan(installAt)
  })
})
