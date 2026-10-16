#!/usr/bin/env node
// tools/structure/cli.mjs — the structure ratchets from the command line.
// @reads tools/structure/*.json
//   node tools/structure/cli.mjs             check (exit 1 on a C1/C3 violation; C2/C4 are reported)
//   node tools/structure/cli.mjs --tighten   shrink the baselines to what is true now
//   node tools/structure/cli.mjs --init      rewrite every baseline from today's state
// CI runs the same check as frontend/src/__tests__/structure-ratchets.test.ts.
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { PROJECTS, loadTypeScript, scanProject } from "./project-scan.mjs"
import { initialBaselines, prepare, runAll, tightenedBaselines } from "./ratchets.mjs"

export const ROOT = new URL("../../", import.meta.url)
export const BASELINE_FILES = {
  cycles: "tools/structure/cycles.json",
  importBudget: "tools/structure/import-budget.json",
  boundaries: "tools/structure/boundaries.json",
  hubs: "tools/structure/hubs.json",
}

/** A missing or unreadable baseline throws — except a missing one under `--init`. */
export function loadBaselines(root = ROOT, { allowMissing = false } = {}) {
  const out = {}
  for (const [k, f] of Object.entries(BASELINE_FILES)) {
    try {
      out[k] = JSON.parse(readFileSync(new URL(f, root), "utf8"))
    } catch (err) {
      if (!(allowMissing && err?.code === "ENOENT")) throw new Error(`${f}: ${err?.message ?? err}`)
    }
  }
  return out
}

export function writeBaselines(baselines, root = ROOT) {
  for (const [k, f] of Object.entries(BASELINE_FILES)) writeFileSync(new URL(f, root), JSON.stringify(baselines[k], null, 2) + "\n")
}

/** Scans backend/src and frontend/src once and runs every ratchet. */
export function scanAndRun(root = ROOT, baselines = loadBaselines(root)) {
  const ts = loadTypeScript(root)
  const graphs = PROJECTS.map((p) => prepare(scanProject(ts, root, p)))
  return { ...runAll(graphs, baselines), baselines }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2]
  if (mode !== undefined && mode !== "--init" && mode !== "--tighten") {
    console.error("usage: node tools/structure/cli.mjs [--tighten | --init]")
    process.exit(2)
  }
  const started = Date.now()
  const result = scanAndRun(ROOT, loadBaselines(ROOT, { allowMissing: mode === "--init" }))
  for (const line of result.summary) console.log(line)
  if (mode === "--init") {
    writeBaselines(initialBaselines(result.current, result.baselines.importBudget?.default ?? 300))
    console.log("baselines rewritten from today's state, violations included. --init is for creating them;\n"
      + "after that every change goes through --tighten, which can only shrink them.")
  } else if (mode === "--tighten") {
    if (result.failures.length > 0) {
      console.error(result.failures.join("\n\n"))
      console.error("\nrefusing to tighten while a ratchet fails — fix the violations first.")
      process.exit(1)
    }
    writeBaselines(tightenedBaselines(result.current, result.baselines))
    console.log("baselines tightened.")
  } else {
    for (const r of result.reports) console.log(r)
    for (const f of result.findings) console.log(f)
    for (const n of result.notes) console.log(`note: ${n}`)
    if (result.failures.length > 0) {
      console.error("\n" + result.failures.join("\n\n"))
      console.error(`\n${result.failures.length} structure ratchet violation(s) (cycles / boundaries). See tools/structure/README.md.`)
      process.exit(1)
    }
    console.log("OK: the cycle and boundary ratchets hold (import budget and hubs are report only).")
  }
  console.log(`(${Date.now() - started} ms)`)
}
