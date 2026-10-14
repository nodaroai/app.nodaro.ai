// tools/test-select/engine.mjs
// Glue between the change list, the graph and the rules — and the one place
// that turns any failure into "run everything".
import { selectTests } from "./select.mjs"

export async function runSelection({ project, readChanges, loadGraph }) {
  try {
    const changes = await readChanges()
    const tests = await loadGraph()
    return { ...selectTests({ project, changes, tests }), total: tests.length }
  } catch (err) {
    const why = String(err?.message ?? err).split("\n")[0]
    return { mode: "full", reason: `selection engine could not decide (${why}) — running everything`, files: [], total: null }
  }
}
