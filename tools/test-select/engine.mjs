// tools/test-select/engine.mjs
// Glue between the change list, the graph and the rules — and the one place
// that turns any failure into "run everything".
import { selectTests } from "./select.mjs"

export async function runSelection({ project, readChanges, loadGraph, loadPackageChunks }) {
  try {
    const changes = await readChanges()
    const tests = await loadGraph()
    return { ...selectTests({ project, changes, tests, packageChunks: await packageChunksOrNone(loadPackageChunks) }), total: tests.length }
  } catch (err) {
    const why = String(err?.message ?? err).split("\n")[0]
    return { mode: "full", reason: `selection engine could not decide (${why}) — running everything`, files: [], total: null }
  }
}

// Build metafiles only narrow a package change. Without them every package is
// judged by the whole-package rule — broader, never a reason for a full run.
async function packageChunksOrNone(load) {
  try {
    return (await load?.()) ?? {}
  } catch {
    return {}
  }
}
